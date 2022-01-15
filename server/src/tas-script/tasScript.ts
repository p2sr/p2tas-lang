import { CompletionList, Diagnostic, DiagnosticSeverity, Position, Range, TextDocumentContentChangeEvent } from "vscode-languageserver";
import { scriptLineComment, createScriptLine, LineType, ScriptLine } from "./scriptLine";
import { DiagnosticCollector } from "./util";

export class TASScript {
    readonly uri: string;

    lines: ScriptLine[] = [];
    fileLines: string[] = [];

    constructor(uri: string) {
        this.uri = uri;
    }

    parse(fileText: string): Diagnostic[] {
        this.lines = [];
        this.fileLines = [];

        let diagnostics: Diagnostic[] = [];
        const diagnosticCollector = new DiagnosticCollector();
        let didFindStart = false;

        let index = 0;
        let currentLine = 0;
        let multilineCommentsOpen = 0;
        // Stores the iterations and the tick count of the 'repeat' line
        let repeats: [number, number][] = [];
        while (index <= fileText.length) {
            let lineText = "";
            while (fileText.charAt(index) !== '\n' && index < fileText.length) {
                const char = fileText.charAt(index);
                if (char !== '\r')
                    lineText += char;
                index++;
            }

            const trimmedLineText = lineText.trim();

            index++;
            this.fileLines.push(lineText);

            let commentLine: ScriptLine | undefined;
            [lineText, multilineCommentsOpen, commentLine] = this.removeComments(lineText, currentLine, multilineCommentsOpen, diagnosticCollector);

            let previousLine = scriptLineComment("", false);

            for (let i = this.lines.length - 1; i >= 0; i--) {
                if (!this.lines[i].isComment) {
                    previousLine = this.lines[i];
                    break;
                }
            }

            if (lineText.length === 0) {
                if (commentLine) {
                    commentLine.activeTools = previousLine.activeTools;
                    this.lines.push(commentLine);
                }
                else this.lines.push(new ScriptLine("", LineType.Framebulk, previousLine.absoluteTick, undefined, previousLine.activeTools));
                currentLine++;
                continue;
            }

            // Start was not the first thing in the file
            if (trimmedLineText.startsWith("start")) {
                if (didFindStart) {
                    // Start was not the first statement in the file! ERROR!
                    diagnosticCollector.addDiagnosticToLine(currentLine, 0, "Multiple start lines found");
                }
                else {
                    const line = createScriptLine(LineType.Start, lineText, currentLine, scriptLineComment("", false), diagnosticCollector); // Essentially an empty line
                    if (commentLine) line!.mergeComments(commentLine)
                    this.lines.push(line!);
                }

                didFindStart = true;
                currentLine++;
                continue;
            }
            else {
                if (!didFindStart) {
                    // Start was not the first statement in the file! ERROR!
                    diagnosticCollector.addDiagnosticToLine(currentLine, 0, "Expected 'start' statement");

                    this.lines.push(createScriptLine(LineType.Start, lineText, currentLine, previousLine, diagnosticCollector));
                    didFindStart = true;
                    currentLine++;
                    continue;
                }
            }

            if (trimmedLineText.startsWith("repeat")) {
                const line = createScriptLine(LineType.RepeatStart, lineText, currentLine, previousLine, diagnosticCollector);
                this.lines.push(line!);

                const parts = lineText.split(' ').filter((part) => part.length > 0);
                repeats.push([parts.length >= 2 ? +parts[1] : 1, previousLine.absoluteTick]);
                currentLine++;
                continue;
            }
            else if (trimmedLineText.startsWith("end")) {
                if (repeats.length === 0) {
                    diagnostics.push(Diagnostic.create(
                        Range.create(Position.create(currentLine, 0), Position.create(currentLine, Number.MAX_VALUE)),
                        "End line outside of loop",
                        DiagnosticSeverity.Error
                    ));
                    this.lines.push(new ScriptLine(lineText, LineType.End, previousLine.absoluteTick));
                    currentLine++;
                    continue;
                }

                const line = createScriptLine(LineType.End, lineText, currentLine, previousLine, diagnosticCollector);

                const [iterations, startTickCount] = repeats.pop()!;
                const loopDuration = line!.absoluteTick - startTickCount;
                // Get the new absolute tick value. Iterations needs to be one less, 
                // since one iteration was already counted when parsing the lines between 'repeat' and 'end'
                line!.absoluteTick += (iterations - 1) * loopDuration;

                this.lines.push(line!);
                currentLine++;
                continue;
            }

            const line = createScriptLine(LineType.Framebulk, lineText, currentLine, previousLine, diagnosticCollector);
            if (commentLine) line!.mergeComments(commentLine)
            this.lines.push(line!);

            const activeTools = line!.activeTools;
            for (let j = 0; j < activeTools.length; j++) {
                if (activeTools[j].ticksRemaining !== undefined) {
                    activeTools[j].ticksRemaining! -= line!.absoluteTick - (previousLine.type === LineType.Start ? 0 : previousLine.absoluteTick);
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

        return diagnosticCollector.getDiagnostics();
    }

    removeComments(lineText: string, currentLine: number, multilineCommentsOpen: number, collector: DiagnosticCollector): [string, number, ScriptLine?] {
        // Check for single line comments
        const singleLineCommentOpenToken = lineText.indexOf('//');
        if (singleLineCommentOpenToken !== -1) {
            lineText = lineText.substring(0, singleLineCommentOpenToken);
            if (lineText.length === 0) {
                // Only return if the line is empty after removing single line comments. 
                // Otherwise we want to continue with the multiline comments.
                return [lineText, multilineCommentsOpen, scriptLineComment(lineText, true)];
            }
        }

        let resultLine: ScriptLine | undefined;

        const multilineCommentOpenToken = lineText.indexOf('/*');
        const multilineCommentCloseToken = lineText.indexOf('*/');
        if (multilineCommentOpenToken !== -1 && multilineCommentCloseToken === -1) {
            multilineCommentsOpen += 1;
            lineText = lineText.substring(0, multilineCommentOpenToken);

            resultLine = scriptLineComment(lineText, true, multilineCommentOpenToken);
        }
        if (multilineCommentCloseToken !== -1) {
            if (multilineCommentOpenToken === -1) {
                multilineCommentsOpen -= 1;
                if (multilineCommentsOpen < 0) {
                    // Comment was closed but never opened
                    collector.addDiagnostic(currentLine, multilineCommentCloseToken, multilineCommentCloseToken + 2, "Comment was never opened!");
                    return [lineText, multilineCommentsOpen, undefined];
                }

                lineText = lineText.substring(multilineCommentCloseToken + 2);
                resultLine = scriptLineComment(lineText, true, undefined, multilineCommentCloseToken);
            }
            else {
                lineText = lineText.substring(0, multilineCommentOpenToken) + lineText.substring(multilineCommentCloseToken + 2);
                resultLine = scriptLineComment(lineText, true, multilineCommentOpenToken, multilineCommentCloseToken);
            }
        }

        return [lineText, multilineCommentsOpen, resultLine];
    }
}