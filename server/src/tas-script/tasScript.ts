import { Diagnostic } from "vscode-languageserver";
import { createScriptLine, LineType, ScriptLine } from "./scriptLine";
import { DiagnosticCollector, CommentRange } from "./util";

export class TASScript {
    lines: ScriptLine[] = [];

    parse(fileText: string): Diagnostic[] {
        this.lines = [];

        const diagnosticCollector = new DiagnosticCollector();
        let didFindStart = false;

        let index = 0;
        let currentLine = 0;
        let multilineCommentsOpen = 0;
        // Stores the iterations, the tick count of the 'repeat' line and the line of the repeat statement
        let repeats: [number, number, number][] = [];
        while (index <= fileText.length) {
            let fullLineText = "";
            while (fileText.charAt(index) !== '\n' && index < fileText.length) {
                const char = fileText.charAt(index);
                if (char !== '\r')
                    fullLineText += char;
                index++;
            }
            index++;

            let lineText: string;
            let commentRange: CommentRange | undefined;
            [lineText, multilineCommentsOpen, commentRange] = this.removeComments(fullLineText, currentLine, multilineCommentsOpen, diagnosticCollector);

            const trimmedLineText = lineText.trim();

            let previousLine = this.lines.length === 0 ? new ScriptLine("", LineType.Framebulk, 0) : this.lines[this.lines.length - 1];

            if (lineText.trim().length === 0 || commentRange?.isWholeLine) {
                this.lines.push(new ScriptLine(fullLineText, LineType.Comment, previousLine.absoluteTick, undefined, previousLine.activeTools, commentRange));
                currentLine++;
                continue;
            }

            if (trimmedLineText.startsWith("start")) {
                if (didFindStart) {
                    diagnosticCollector.addDiagnosticToLine(currentLine, 0, "Multiple start lines found");
                }
                else {
                    const line = createScriptLine(LineType.Start, lineText, currentLine, previousLine, diagnosticCollector);
                    line.commentRange = commentRange;
                    this.lines.push(line);
                }

                didFindStart = true;
                currentLine++;
                continue;
            }
            else {
                if (!didFindStart) {
                    // Start was not the first statement in the file
                    diagnosticCollector.addDiagnosticToLine(currentLine, 0, "Expected 'start' statement");
                    didFindStart = true;
                    // We don't continue here, since we want to still parse the line after we've informed the user
                }
            }

            if (trimmedLineText.startsWith("repeat")) {
                const line = createScriptLine(LineType.RepeatStart, lineText, currentLine, previousLine, diagnosticCollector);
                this.lines.push(line);

                const parts = lineText.split(' ').filter((part) => part.length > 0);
                repeats.push([parts.length >= 2 ? +parts[1] : 1, previousLine.absoluteTick, currentLine]);
                currentLine++;
                continue;
            }
            else if (trimmedLineText.startsWith("end")) {
                if (repeats.length === 0) {
                    diagnosticCollector.addDiagnosticToLine(currentLine, 0, "End line outside of loop");
                    this.lines.push(new ScriptLine(lineText, LineType.End, previousLine.absoluteTick));
                    currentLine++;
                    continue;
                }

                const line = createScriptLine(LineType.End, lineText, currentLine, previousLine, diagnosticCollector);

                const [iterations, startTickCount] = repeats.pop()!;
                const loopDuration = line.absoluteTick - startTickCount;
                // Get the new absolute tick value. Iterations needs to be one less, 
                // since one iteration was already counted when parsing the lines between 'repeat' and 'end'
                line.absoluteTick += (iterations - 1) * loopDuration;

                this.lines.push(line);
                currentLine++;
                continue;
            }

            const line = createScriptLine(LineType.Framebulk, lineText, currentLine, previousLine, diagnosticCollector);
            line.commentRange = commentRange;
            this.lines.push(line);

            const activeTools = line!.activeTools;
            for (let j = 0; j < activeTools.length; j++) {
                if (activeTools[j].ticksRemaining !== undefined) {
                    activeTools[j].ticksRemaining! -= line.absoluteTick - (previousLine.type === LineType.Start ? 0 : previousLine.absoluteTick);
                    if (activeTools[j].ticksRemaining! <= 0) {
                        if (activeTools[j].tool === "autoaim") {
                            activeTools[j].startTick = undefined;
                            activeTools[j].ticksRemaining = undefined;
                            continue;
                        }

                        activeTools.splice(j, 1);
                        j--;
                    }
                }
            }

            currentLine++;
        }

        if (repeats.length > 0) {
            for (const [_, __, line] of repeats) {
                diagnosticCollector.addDiagnosticToLine(line, this.lines[line].lineText.match(/\S/)?.index || 0, "Unterminated loop");
            }
        }

        return diagnosticCollector.getDiagnostics();
    }

    removeComments(lineText: string, currentLine: number, multilineCommentsOpen: number, collector: DiagnosticCollector): [string, number, CommentRange?] {
        if (multilineCommentsOpen === 0) {
            // Check for single line comments
            const singleLineCommentOpenToken = lineText.indexOf('//');
            if (singleLineCommentOpenToken !== -1) {
                const newLineText = lineText.substring(0, singleLineCommentOpenToken);

                if (lineText.length === 0) {
                    return [
                        newLineText,
                        0,
                        new CommentRange(0, lineText.length, true)
                    ];
                }

                return [
                    newLineText,
                    0,
                    new CommentRange(singleLineCommentOpenToken, lineText.length)
                ];
            }
        }

        const multilineCommentOpenToken = lineText.indexOf('/*');
        const multilineCommentCloseToken = lineText.indexOf('*/');

        if (multilineCommentOpenToken === -1 && multilineCommentCloseToken === -1)
            return [lineText, multilineCommentsOpen, multilineCommentsOpen > 0 ? new CommentRange(0, lineText.length, true) : undefined];

        const commentRange = new CommentRange(multilineCommentOpenToken, multilineCommentCloseToken === -1 ? -1 : multilineCommentCloseToken + 2);

        if (commentRange.start !== -1 && commentRange.end === -1) {
            return [
                lineText.substring(0, commentRange.start),
                multilineCommentsOpen + 1,
                new CommentRange(commentRange.start, lineText.length, commentRange.start === 0)
            ];
        }
        else if (commentRange.start === -1 && commentRange.end !== -1) {
            const newMultilineCommentsOpen = multilineCommentsOpen - 1;
            if (newMultilineCommentsOpen < 0)
                collector.addDiagnostic(currentLine, commentRange.end - 2, commentRange.end, "Comment was never opened");

            return [
                lineText.substring(commentRange.end),
                multilineCommentsOpen - 1,
                new CommentRange(0, commentRange.end, commentRange.end === lineText.length)
            ];
        }
        else {
            return [
                lineText.substring(0, commentRange.start) + lineText.substring(commentRange.end),
                multilineCommentsOpen,
                commentRange
            ];
        }
    }
}