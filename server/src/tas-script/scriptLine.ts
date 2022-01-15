import { Diagnostic, DiagnosticSeverity, Position, Range } from "vscode-languageserver/node";
import { TASTool } from "./tasTool";
import { DiagnosticCollector, startTypes } from "./util";

export enum LineType {
    Start, RepeatStart, End, Framebulk, Comment
}

export class ScriptLine {
    lineText: string;

    type: LineType;
    absoluteTick: number;
    relativeTick?: number;

    activeTools: TASTool.Tool[];

    // Comments
    isComment: boolean = false;
    multilineCommentStart?: number;
    multilineCommentEnd?: number;

    constructor(
        lineText: string,
        type: LineType,
        absoluteTick: number,
        relativeTick?: number,
        activeTools?: TASTool.Tool[],
        isComment?: boolean,
        multilineCommentStart?: number,
        multilineCommentEnd?: number
    ) {
        this.lineText = lineText;

        this.type = type;
        this.absoluteTick = absoluteTick;
        this.relativeTick = relativeTick;

        this.activeTools = activeTools || [];

        if (isComment)
            this.isComment = isComment;
        this.multilineCommentStart = multilineCommentStart;
        this.multilineCommentEnd = multilineCommentEnd;
    }

    mergeComments(otherLine: ScriptLine) {
        this.isComment = otherLine.isComment;
        this.multilineCommentStart = otherLine.multilineCommentStart;
        this.multilineCommentEnd = otherLine.multilineCommentEnd;
    }
}

export function scriptLineComment(lineText: string = "", isComment: boolean = true, multilineCommentStart?: number, multilineCommentEnd?: number): ScriptLine {
    return new ScriptLine(lineText, LineType.Comment, 0, 0, [], isComment, multilineCommentStart, multilineCommentEnd);
}

export function createScriptLine(type: LineType, lineText: string, line: number, previousLine: ScriptLine | undefined, collector: DiagnosticCollector): ScriptLine {
    switch (type) {
        case LineType.Start:
            return parseStartStatement(lineText, line, collector);
        case LineType.RepeatStart:
            return parseRepeatStatement(lineText, line, previousLine!, collector);
        case LineType.End:
            return parseEndStatement(lineText, line, previousLine!, collector);
        case LineType.Framebulk:
            return parseFramebulk(lineText, line, previousLine!, collector);
        default:
            throw new Error("Unreachable!");
    }
}

function getParts(text: string): [string[], number] {
    return [text.trim().split(' '), text.match(/\S/)?.index || 0];
}

function parseStartStatement(lineText: string, line: number, collector: DiagnosticCollector): ScriptLine {
    const [args, firstCharacter] = getParts(lineText);

    if (args.length < 2) {
        collector.addDiagnosticToLine(line, lineText.length - 1, "Expected start type");
    }
    else if (args.length > 2) {
        collector.addDiagnosticToLine(line, firstCharacter + args[0].length + args[1].length + 2, "Ignored start parameters", DiagnosticSeverity.Warning);
    }
    else {
        const valid = startTypes.map((type) => type.name).includes(args[1]);
        if (!valid) collector.addDiagnosticToLine(line, firstCharacter + args[0].length + 1, "Invalid start type");
    }

    return new ScriptLine(lineText, LineType.Start, -1);
}

function parseRepeatStatement(lineText: string, line: number, previousLine: ScriptLine, collector: DiagnosticCollector): ScriptLine {
    let [parts, firstCharacter] = getParts(lineText);
    parts = parts.filter((part) => part.length > 0)

    if (parts.length != 2) {
        collector.addDiagnosticToLine(line, 0, "Invalid repeat line");
    }

    if (parts.length >= 2) {
        const iterations = +parts[1];
        if (isNaN(iterations)) {
            collector.addDiagnostic(line, firstCharacter + parts[0].length + 1, firstCharacter + parts[0].length + 1 + parts[1].length, "Expected an integer");
        }
        else if (iterations < 0) {
            collector.addDiagnostic(line, firstCharacter + parts[0].length + 1, firstCharacter + parts[0].length + 1 + parts[1].length, "Expected more than one iteration");
        }
    }

    return new ScriptLine(lineText, LineType.RepeatStart, previousLine.absoluteTick, undefined, previousLine.activeTools);
}

function parseEndStatement(lineText: string, line: number, previousLine: ScriptLine, collector: DiagnosticCollector): ScriptLine {
    if (lineText.trim().split(' ').length !== 1) {
        collector.addDiagnosticToLine(line, 0, "Invalid end line");
    }

    return new ScriptLine(lineText, LineType.End, previousLine.absoluteTick, undefined, previousLine.activeTools);
}

function parseFramebulk(lineText: string, line: number, previousLine: ScriptLine, collector: DiagnosticCollector): ScriptLine {
    const [tick, isRelative] = parseFramebulkTick(lineText, line, previousLine, collector);
    const currentTick = isRelative ? previousLine.absoluteTick + tick : tick;

    // Check if the line has more than four "|" in it
    if (lineText.split("|").length - 1 > 4) {
        let pipesFound = 0;
        let index = 0;
        // Find the fourth pipe
        while (pipesFound <= 4 && index < lineText.length) {
            if (lineText.charAt(index) === '|') pipesFound++;
            index++;
        }

        collector.addDiagnosticToLine(line, index, "Unexpected part of framebulk");
    }

    let lastPipe: number = lineText.indexOf('>');
    if (lastPipe === -1) {
        return new ScriptLine(lineText, LineType.Framebulk, currentTick, isRelative ? tick : undefined, previousLine.activeTools);
    }

    let activeTools: TASTool.Tool[] = [];
    for (let component = 0; component < 5; component++) {
        switch (component) {
            case 0:
            case 1:
                lastPipe = parseVector(lineText, line, lastPipe + 1, collector);
                break;
            case 2:
                lastPipe = parseButtons(lineText, line, lastPipe + 1, collector);
                break;
            case 4:
                // Only if the tools field exists
                if (lineText.split("|").length - 1 === 4) {
                    [lastPipe, activeTools] = parseTools(lineText, line, currentTick, lineText.lastIndexOf('|'), previousLine, collector);
                }
                else activeTools = previousLine.activeTools;
                break;
            default:
                continue;
        }

        if (lastPipe >= lineText.length) {
            return new ScriptLine(lineText, LineType.Framebulk, currentTick, isRelative ? tick : undefined, activeTools);
        }
    }

    return new ScriptLine(lineText, LineType.Framebulk, currentTick, isRelative ? tick : undefined, activeTools);
}

function parseFramebulkTick(lineText: string, line: number, previousLine: ScriptLine, collector: DiagnosticCollector): [number, boolean] {
    const trimmedText = lineText.trim();
    const firstCharacter = lineText.match(/\S/)?.index || 0;

    if (trimmedText.startsWith('+')) {
        if (!/^\+\d.*$/.test(trimmedText)) {
            collector.addDiagnostic(line, firstCharacter, 0, "Expected integer after '+'");
        }

        if (!/^\+\d*>.*$/.test(trimmedText)) {
            collector.addDiagnosticToLine(line, firstCharacter, "Expected '>' after tick");
        }

        const arrow = trimmedText.indexOf('>');
        const tick = +trimmedText.substring(1, arrow);
        if (tick < 1) {
            collector.addDiagnostic(line, 0, firstCharacter + arrow, "Expected positive tick delta");
        }

        // TODO: Test here if it's the first tick in the file

        return [tick, true];
    }
    else if (/^\d.*$/.test(trimmedText)) { // checks if `lineText` starts with a number
        if (!/^\d*>.*$/.test(trimmedText)) {
            collector.addDiagnostic(line, firstCharacter, 0, "Expected '>' after tick");
        }

        const tick = +trimmedText.substring(0, trimmedText.indexOf('>'));
        if (tick < 0) {
            collector.addDiagnosticToLine(line, firstCharacter, "Expected non-negative tick");
        }

        if (tick <= previousLine.absoluteTick) {
            collector.addDiagnosticToLine(line, firstCharacter, `Expected tick greater than ${previousLine.absoluteTick}`);
        }

        return [tick, false];
    }
    else {
        collector.addDiagnosticToLine(line, 0, "Expected tick at start of line");
    }

    return [0, false];
}

function parseVector(lineText: string, line: number, startIndex: number, collector: DiagnosticCollector): number {
    let pipe = lineText.substring(startIndex).indexOf('|');
    if (pipe === -1) pipe = lineText.length;
    else pipe += startIndex;
    const movementPart = lineText.substring(startIndex, pipe);
    if (movementPart.length === 0) return pipe;

    const movementParts = movementPart.split(' ');

    let partsCount = 0;
    movementParts.forEach((part) => { if (part.length > 0) partsCount++; });

    if (partsCount !== 2) {
        collector.addDiagnostic(line, startIndex + 1, pipe, "Expected vector");
    }

    const checkPart = (index: number) => {
        if (movementParts.length >= index + 1 && isNaN(+movementParts[index])) {
            collector.addDiagnostic(line, startIndex, startIndex + movementParts[index].length, "Expected number");
        }
    };

    checkPart(0);
    checkPart(1);

    return pipe;
}

function parseButtons(lineText: string, line: number, startIndex: number, collector: DiagnosticCollector): number {
    let pipe = lineText.substring(startIndex).indexOf('|');
    if (pipe === -1) pipe = lineText.length;
    else pipe += startIndex;

    for (let i = startIndex; i < pipe; i++) {
        let button = lineText.charAt(i);

        let wasUpper = false;
        if (button >= 'A' && button <= 'Z') {
            wasUpper = true;
            button = button.toLowerCase();
        }

        if (!(button >= 'a' && button <= 'z')) {
            collector.addDiagnostic(line, i, i + 1, "Expected letter");
        }

        if (!/^[jduzbo].*$/.test(button)) {
            collector.addDiagnostic(line, i, i + 1, "Invalid button character");
        }

        if (i + 1 < pipe && wasUpper) {
            if (!isNaN(+lineText.charAt(i + 1))) {
                let durationStr = "";
                i++;
                while (i < pipe) {
                    const char = lineText.charAt(i);
                    if (/^\d$/.test(char)) durationStr += char;
                    else break;
                    i++;
                }

                if (+durationStr <= 0) {
                    collector.addDiagnostic(line, i - durationStr.length, i, "Button pressed for less than one tick");
                }
            }
        }
    }

    return pipe;
}

function parseTools(lineText: string, line: number, currentTick: number, startIndex: number, previousLine: ScriptLine, collector: DiagnosticCollector): [number, TASTool.Tool[]] {
    // These functions use the variables defined in the outer function, and are called from below code

    // validateToolArgument validates the tool argument and changes didFindOffArg to true if needed
    function validateToolArgument(index: number) {
        const toolArg = TASTool.getToolArgument(toolName, arg);
        if (!toolArg) {
            collector.addDiagnostic(line, index - arg.length, index, `Tool '${toolName}' does not have argument '${arg}'`);
            return;
        }

        if (toolArg && toolArg.type === TASTool.ToolArgumentType.Off) {
            didFindOffArg = true;
        }
    }

    function handleToolArgument() {
        if (didFindOffArg) {
            const index = activeTools.findIndex((tasTool) => tasTool.tool === (toolName === "decel" ? "(decel)" : toolName))
            activeTools.splice(index, 1);
        }
        else {
            if (toolName === "decel")
                activeTools.push(new TASTool.Tool("(decel)"));
            else {
                const tool = TASTool.tools[toolName];
                if (tool.durationPos !== undefined) {
                    activeTools.push(new TASTool.Tool(toolName, currentTick, +argumentsGiven[tool.durationPos - 1]));
                }
                else {
                    activeTools.push(new TASTool.Tool(toolName));
                }
            }
        }
    }

    // activeTools would otherwise be a reference
    const activeTools = previousLine.activeTools.map((elem) => elem.copy());

    let toolName = "";
    let toolArguments: TASTool.ToolArgument[] | undefined;
    let argumentsGiven: string[] = [];
    let arg = "";
    let foundTool = false;
    let didFindOffArg = false;
    for (let i = startIndex + 1; i < lineText.length; i++) {
        const char = lineText.charAt(i);
        if (!foundTool) {
            if (char === ' ') {
                if (toolName.length === 0) continue;

                if (!TASTool.tools.hasOwnProperty(toolName)) {
                    collector.addDiagnostic(line, i - toolName.length, i, `Tool '${toolName}' does not exist`);

                    toolName = "";
                    // Fast forward to the ';'
                    while (i < lineText.length && lineText.charAt(++i) !== ';');
                    continue;
                }
                foundTool = true;
                toolArguments = TASTool.tools[toolName].arguments;

                continue;
            }

            toolName += char;
            continue;
        }

        if (char === ' ') {
            if (arg.length === 0) continue;

            arg = arg.trim();
            validateToolArgument(i);
            argumentsGiven.push(arg);
            arg = "";
            continue;
        }
        else if (char === ';') {
            arg = arg.trim();
            validateToolArgument(i);
            argumentsGiven.push(arg);
            arg = "";

            handleToolArgument();

            toolName = "";
            foundTool = false;
            toolArguments = undefined;
            didFindOffArg = false;
            argumentsGiven = [];

            continue;
        }

        arg += char;
    }

    // The end of the line was reached, so the last argument might not have been parsed
    if (arg.length > 0) {
        arg = arg.trim();
        validateToolArgument(lineText.length);
        argumentsGiven.push(arg);
        arg = "";

        handleToolArgument();
    }

    return [lineText.length, activeTools];
}