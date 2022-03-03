import { DiagnosticSeverity } from "vscode-languageserver/node";
import { TASTool } from "./tasTool";
import { CommentRange, DiagnosticCollector, startTypes } from "./util";

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
    commentRange?: CommentRange = undefined;

    constructor(
        lineText: string,
        type: LineType,
        absoluteTick: number,
        relativeTick?: number,
        activeTools?: TASTool.Tool[],
        commentRange?: CommentRange,
    ) {
        this.lineText = lineText;

        this.type = type;
        this.absoluteTick = absoluteTick;
        this.relativeTick = relativeTick;

        this.activeTools = activeTools || [];

        this.commentRange = commentRange;
    }
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

// Returns: 
// - the text parts (trimmed, splitted on ' ')
// - the first non-whitespace character index
// - the last non-whitespace character index
function getParts(text: string): [string[], number, number] {
    return [text.trim().split(' '), text.match(/\S/)?.index || 0, text.match(/\S(?=\s*$)/)?.index || text.length - 1];
}

function parseStartStatement(lineText: string, line: number, collector: DiagnosticCollector): ScriptLine {
    const [args, firstCharacter, lastCharacter] = getParts(lineText);

    if (args.length < 2) {
        collector.addDiagnosticToLine(line, lastCharacter, "Expected start type");
    }
    else if (args.length >= 2) {
        const startType = startTypes[args[1]];
        if (startType) {
            if (!(startType.hasArgument || false)) {
                if (args.length > 2) {
                    collector.addDiagnosticToLine(line, firstCharacter + args[0].length + args[1].length + 2, "Ignored start parameters", DiagnosticSeverity.Warning);
                }
            }
            else {
                if (args.length > 3) {
                    collector.addDiagnosticToLine(line, firstCharacter + args[0].length + args[1].length + args[2].length + 3, "Ignored start parameters", DiagnosticSeverity.Warning);
                }
                else if (args.length === 2) {
                    collector.addDiagnosticToLine(line, lastCharacter, "Expected argument");
                }
            }
        }
        else {
            collector.addDiagnosticToLine(line, firstCharacter + args[0].length + 1, "Invalid start type");
        }
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

    let activeTools: TASTool.Tool[] = previousLine.activeTools;
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
            collector.addDiagnostic(line, firstCharacter, firstCharacter + 1, "Expected integer after '+'");
        }

        if (!/^\+\d*>.*$/.test(trimmedText)) {
            collector.addDiagnosticToLine(line, firstCharacter, "Expected '>' after tick");
        }

        const arrow = trimmedText.indexOf('>');
        const tick = +trimmedText.substring(1, arrow);
        if (tick < 1) {
            collector.addDiagnostic(line, 0, firstCharacter + arrow, "Expected positive tick delta");
        }

        if (previousLine.absoluteTick === -1) {
            collector.addDiagnosticToLine(line, firstCharacter, "First framebulk in file is relative");
        }

        return [previousLine.absoluteTick === -1 ? tick + 1 : tick, true];
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
        if (button === ' ') continue;

        let wasUpper = false;
        if (button >= 'A' && button <= 'Z') {
            wasUpper = true;
            button = button.toLowerCase();
        }

        if (!(button >= 'a' && button <= 'z')) {
            collector.addDiagnostic(line, i, i + 1, "Expected letter");
        }
        else if (!/^[jduzbo].*$/.test(button)) {
            collector.addDiagnostic(line, i, i + 1, "Invalid button character");
        }

        if (i + 1 < pipe && wasUpper) {
            if (!isNaN(+lineText.charAt(i + 1))) {
                let durationStr = "";
                i++;
                // Put all following numbers into durationStr
                while (i < pipe) {
                    const char = lineText.charAt(i);
                    if (/^\d$/.test(char)) durationStr += char;
                    else {
                        // Need to decrement i again, since the outer loop will increment i for us
                        i--;
                        break;
                    }
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
    function validateToolArgument(toolName: string, arg: string, index: number, firstCharacter: number): [TASTool.ToolArgument | undefined, boolean] {
        const toolArg = TASTool.getToolArgument(toolName, arg);
        if (!toolArg) {
            collector.addDiagnostic(line, index + firstCharacter, index + arg.length, `Tool '${toolName}' does not have argument '${arg}'`);
            return [undefined, false];
        }

        // didFindOffArg
        return [toolArg, toolArg.type === TASTool.ToolArgumentType.Off];
    }

    function updateActiveTools(toolName: string, didFindOffArg: boolean, argumentsGiven: string[]) {
        // Ensure that all occurrences are removed
        let index = activeTools.findIndex((tasTool) => tasTool.tool === (toolName === "decel" ? "(decel)" : toolName));
        while (index !== -1) {
            activeTools.splice(index, 1);
            index = activeTools.findIndex((tasTool) => tasTool.tool === (toolName === "decel" ? "(decel)" : toolName));
        }

        if (!didFindOffArg) {
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

    let index = startIndex + 1;
    lineText.substring(startIndex + 1).split(';').forEach(toolDecl => {
        toolDecl = toolDecl.trim();
        if (toolDecl.length === 0) return;
        const [parts, firstCharacter, lastCharacter] = getParts(toolDecl);

        let toolName = "";
        let argumentsGiven: { text: string, argument?: TASTool.ToolArgument }[] = [];
        let foundTool = false;
        let didFindOffArg = false;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (part.length === 0) continue;
            
            if (!foundTool) {
                toolName = part;
                if (!TASTool.tools.hasOwnProperty(toolName)) {
                    collector.addDiagnostic(line, index + firstCharacter, index + lastCharacter + 1, `Tool '${toolName}' does not exist`);

                    toolName = "";
                    return;
                }
                foundTool = true;
            }
            else {
                const arg = part.trim();
                let toolArg: TASTool.ToolArgument | undefined;
                [toolArg, didFindOffArg] = validateToolArgument(toolName, arg, index, firstCharacter);
                argumentsGiven.push({ text: arg, argument: toolArg });
            }

            index += part.length;
            if (i < parts.length - 1) index++;
        }

        updateActiveTools(toolName, didFindOffArg, argumentsGiven.map((elem) => elem.text));
        if (argumentsGiven.length === 0) {
            collector.addDiagnosticToLine(line, index + lastCharacter - 1, "Expected arguments");
        }
        else if (argumentsGiven.findIndex((elem) => elem.argument && elem.argument.type === TASTool.ToolArgumentType.Off) === -1 && argumentsGiven.length < TASTool.tools[toolName].requiredArgumentsCount) {
            collector.addDiagnosticToLine(line, index + lastCharacter - 1, "Too few arguments");
        }

        index += 1;
        while (lineText.charAt(++index) === ' ' && index < lineText.length);
    });

    return [lineText.length, activeTools];
}