import { Diagnostic, integer } from "vscode-languageserver/node";
import { DiagnosticCollector } from "./diagnosticCollector";
import { TASTool } from "./tasTool";
import { Token, tokenize, TokenType } from "./tokenizer";

enum ParserState {
    Version, Start, RngManip, Framebulks
}

export class TASScript {

    lines = new Map<number, ScriptLine>();

    tokens: Token[][] = [];
    lineIndex = 0;
    tokenIndex = 0;

    private previousLine(): ScriptLine | undefined {
        const entries = Array.from(this.lines.entries());
        if (entries.length === 0) return undefined;
        return entries[entries.length - 1][1];
    }

    parse(fileText: string): Diagnostic[] {
        new DiagnosticCollector();

        this.lineIndex = 0;
        this.tokenIndex = 0;
        this.lines = new Map<number, ScriptLine>();

        var lines: string[] = [];
        [this.tokens, lines] = tokenize(fileText);

        var state = ParserState.Version;
        var isFirstFramebulk = true;

        // Stack for nested repeats; stores iterations, starting tick, lineIndex of "repeat"
        var repeats: [number, number, number][] = [];

        while (this.lineIndex < this.tokens.length) {
            if (this.tokens[this.lineIndex].length === 0) {
                const previousLine = this.previousLine()!;
                const keys = Array.from(this.lines.keys());
                this.lines.set(keys[keys.length - 1] + 1, new ScriptLine("", previousLine?.tick || 0, false, LineType.Framebulk, previousLine?.activeTools || [], []));

                this.lineIndex++;
                continue;
            }

            const currentLine = this.tokens[this.lineIndex][0].line;
            const currentLineText = lines[currentLine];

            switch (state) {
                case ParserState.Version:
                    this.expectText("Expected version", "version");
                    this.expectNumber("Invalid version", 1, 2, 3, 4);
                    this.expectCount("Ignored parameters", 2);

                    this.lines.set(currentLine, new ScriptLine(currentLineText, 0, false, LineType.Version, [], this.tokens[this.lineIndex]));
                    state = ParserState.Start;
                    break;
                case ParserState.Start:
                    this.expectText("Expected start", "start");
                    const startType = this.expectText("Expected start type", "map", "save", "cm", "now", "next");

                    const checkStartTypeWithNumber = (startType: string, isNested: boolean): boolean => {
                        if (startType !== "map" && startType !== "save") return false;

                        if (!this.isNextType(TokenType.Number)) return false;

                        const numberToken = this.tokens[this.lineIndex][this.tokenIndex - 1];
                        const nextToken = this.currentToken();
                        if (nextToken === undefined) return true;

                        // Check for adjacency (e.g.: valid: 03test, invalid: 03 test)
                        if (nextToken.start !== numberToken.end) {
                            this.expectCount("Ignored parameters", 3 + (isNested ? 1 : 0));
                            return false;
                        }

                        if (nextToken.type !== TokenType.String)
                            DiagnosticCollector.addDiagnostic(nextToken.line, nextToken.start, nextToken.end, "Invalid token");
                        this.expectCount("Ignored parameters", 4 + (isNested ? 1 : 0));
                        return true;
                    };

                    if (startType !== undefined) {
                        if (startType === "next") {
                            const startType = this.expectText("Expected start type", "map", "save", "cm", "now");

                            if (startType !== undefined) {
                                if (startType === "now")
                                    this.expectCount("Ignored parameters", 3);
                                else outer: {
                                    const shouldReturn = checkStartTypeWithNumber(startType, true);
                                    if (shouldReturn) break outer;

                                    this.expectText("Expected parameter");
                                    this.expectCount("Ignored parameters", 4);
                                }
                            }
                        }
                        else {
                            if (startType === "now")
                                this.expectCount("Ignored parameters", 2);
                            else outer: {
                                const shouldReturn = checkStartTypeWithNumber(startType, false);
                                if (shouldReturn) break outer;

                                this.expectText("Expected parameter");
                                this.expectCount("Ignored parameters", 3);
                            }
                        }
                    }

                    this.lines.set(currentLine, new ScriptLine(currentLineText, 0, false, LineType.Start, [], this.tokens[this.lineIndex]));
                    state = ParserState.RngManip;
                    break;
                case ParserState.RngManip:
                    const token = this.next("Expected framebulks or rngmanip");
                    if (token === undefined) break;
                    
                    if (token.type === TokenType.String && token.text === "rngmanip") {
                        this.expectText("Expected parameter");
                        this.expectCount("Ignored parameters", 2)
                    } else {
                        this.lineIndex--;
                    }
                    state = ParserState.Framebulks;
                    break;
                case ParserState.Framebulks:
                    if (this.isNextType(TokenType.String)) {
                        const token = this.tokens[this.lineIndex][this.tokenIndex - 1];
                        if (token.text === "repeat") {
                            const tick = this.previousLine()!.tick;
                            const repeatCount = this.expectNumber("Expected repeat count");

                            if (repeatCount !== undefined)
                                repeats.push([repeatCount, tick, this.lineIndex]);
                            this.lines.set(currentLine, new ScriptLine(currentLineText, tick, false, LineType.RepeatStart, this.previousLine()!.activeTools, this.tokens[this.lineIndex]));
                            break;
                        }
                        else if (token.text === "end") {
                            var endTick = 0;
                            if (repeats.length === 0) {
                                DiagnosticCollector.addDiagnostic(token.line, token.start, token.end, "End outside of loop")
                                endTick = this.previousLine()!.tick;
                            }
                            else {
                                const [iterations, startingTick] = repeats.pop()!;
                                const repeatEnd = this.previousLine()!.tick;
                                endTick = this.previousLine()!.tick + (repeatEnd - startingTick) * (iterations - 1);
                            }
                            this.lines.set(currentLine, new ScriptLine(currentLineText, endTick, false, LineType.End, this.previousLine()!.activeTools, this.tokens[this.lineIndex]));
                            break;
                        }
                        else {
                            DiagnosticCollector.addDiagnostic(token.line, token.start, token.end, "Unexpected token");
                            this.lines.set(currentLine, new ScriptLine(currentLineText, -1, false, LineType.Framebulk, this.previousLine()!.activeTools, this.tokens[this.lineIndex]));
                            break;
                        }
                    }

                    const maybePlus = this.currentToken();
                    const isRelative = this.isNextType(TokenType.Plus);
                    if (isRelative && isFirstFramebulk)
                        DiagnosticCollector.addDiagnostic(maybePlus.line, maybePlus.start, maybePlus.end, "First framebulk cannot be relative");

                    const tick = this.expectNumber("Expected tick") || 0;
                    const angle_token = this.expectType("Expected '>' or '>>'", TokenType.RightAngle, TokenType.DoubleRightAngle);

                    const skip_to_tools = (angle_token !== undefined) && (angle_token.type === TokenType.DoubleRightAngle);

                    var activeTools = this.previousLine()!.activeTools.map((val) => val.copy());

                    var absoluteTick = isRelative ? this.previousLine()!.tick + tick : tick;
                    const previousLineTick = this.previousLine()!.tick;

                    for (var i = 0; i < activeTools.length; i++) {
                        if (activeTools[i].ticksRemaining === undefined) continue;
                        activeTools[i].ticksRemaining! -= absoluteTick - previousLineTick;

                        if (activeTools[i].ticksRemaining! <= 0) {
                            if (activeTools[i].tool === "autoaim") {
                                activeTools[i].ticksRemaining = undefined;
                                continue;
                            }
                            activeTools.splice(i, 1);
                        }
                    }

                    blk: {

                        if (!skip_to_tools) {
                            // Movement field
                            this.expectVector();
                            if (this.tokens[this.lineIndex].length <= this.tokenIndex) break blk;
                            this.expectType("Expected '|'", TokenType.Pipe);

                            // Angles field
                            this.expectVector();
                            if (this.tokens[this.lineIndex].length <= this.tokenIndex) break blk;
                            this.expectType("Expected '|'", TokenType.Pipe);

                            // Buttons field
                            this.parseButtonsField();
                            if (this.tokens[this.lineIndex].length <= this.tokenIndex) break blk;
                            this.expectType("Expected '|'", TokenType.Pipe);

                            // Commands field
                            // Allow any number tokens until pipe or end of line
                            while (this.tokenIndex < this.tokens[this.lineIndex].length && this.currentToken().type !== TokenType.Pipe)
                                this.tokenIndex++;

                            this.tokenIndex++;
                            if (this.tokens[this.lineIndex].length <= this.tokenIndex) break blk;
                        }
                        
                        // Tools field
                        this.parseToolsField(activeTools);
                        if (this.tokens[this.lineIndex].length > this.tokenIndex) {
                            const token = this.currentToken();
                            DiagnosticCollector.addDiagnosticToLine(token.line, token.end, "Unexpected tokens");
                        }
                    }

                    this.lines.set(currentLine, new ScriptLine(currentLineText, absoluteTick, isRelative, LineType.Framebulk, activeTools, this.tokens[this.lineIndex]));
                    isFirstFramebulk = false;
                default:
                    break;
            }

            this.tokenIndex = 0;
            this.lineIndex++;
        }

        if (state === ParserState.Version) {
            DiagnosticCollector.addDiagnosticToLine(integer.MAX_VALUE, 0, "Expected version");
        }
        else if (state === ParserState.Start) {
            DiagnosticCollector.addDiagnosticToLine(integer.MAX_VALUE, 0, "Expected start line");
        }
        else if (state === ParserState.Framebulks && isFirstFramebulk) {
            DiagnosticCollector.addDiagnosticToLine(integer.MAX_VALUE, 0, "Expected framebulks");
        }

        // Check for unterminated loops
        if (repeats.length > 0) {
            for (const [_, __, line] of repeats) {
                DiagnosticCollector.addDiagnosticToLine(line, 0, "Unterminated loop");
            }
        }

        return DiagnosticCollector.getDiagnostics();
    }

    private parseButtonsField() {
        if (this.tokens[this.lineIndex].length <= this.tokenIndex) return;
        if (this.isNextType(TokenType.Pipe)) {
            this.tokenIndex--; // Decrement token index for the check to pass after this function
            return;
        }

        const buttons = this.expectText("Expected buttons") || "";
        const token = this.currentToken();
        for (var i = 0; i < buttons.length; i++) {
            var button = buttons[i];
            var wasUpper = false;
            if (button >= 'A' && button <= 'Z') {
                wasUpper = true;
                button = button.toLowerCase();
            }

            if (!/^[jduzbo].*$/.test(button))
                DiagnosticCollector.addDiagnostic(token.line, token.start + i, token.start + i + 1, "Invalid button character");

            if (i + 1 < buttons.length && wasUpper) {
                var durationStr = "";
                while (++i < buttons.length && /^\d/.test(buttons[i])) {
                    durationStr += buttons[i];
                }
                i--;

                if (durationStr.length !== 0 && +durationStr <= 0)
                    DiagnosticCollector.addDiagnostic(token.line, token.start + i, token.start + i + durationStr.length, "Invalid button duration");
            }
        }
    }

    private parseToolsField(activeTools: TASTool.Tool[]) {
        while (this.tokens[this.lineIndex].length > this.tokenIndex) {
            if (this.isNextType(TokenType.Semicolon)) continue;

            const toolName = this.expectText("Expected tool");
            const toolNameToken = this.tokens[this.lineIndex][this.tokenIndex - 1];
            if (toolName === undefined || !TASTool.tools.hasOwnProperty(toolName)) {
                DiagnosticCollector.addDiagnostic(toolNameToken.line, toolNameToken.start, toolNameToken.end, "Invalid tool");
                this.moveToNextSemicolon();
                continue;
            }

            if (this.isNextType(TokenType.Semicolon) || this.tokenIndex >= this.tokens[this.lineIndex].length) {
                DiagnosticCollector.addDiagnosticToLine(toolNameToken.line, toolNameToken.end, "Expected arguments");
                this.tokenIndex++;
                continue;
            }

            const toolIndex = activeTools.findIndex((val) => val.tool === toolName || val.tool === `(${toolName})`);
            if (toolIndex !== -1) activeTools.splice(toolIndex, 1);

            const tool = TASTool.tools[toolName];
            const firstArgument = this.tokens[this.lineIndex][this.tokenIndex];
            if (tool.hasOff && firstArgument.type === TokenType.String && firstArgument.text === "off") {
                this.tokenIndex++;
                if (this.tokenIndex >= this.tokens[this.lineIndex].length) return;
                if (!this.isNextType(TokenType.Semicolon)) {
                    const token = this.currentToken();
                    this.moveToNextSemicolon();
                    const lastToken = this.tokens[this.lineIndex][this.tokenIndex - (this.tokenIndex === this.tokens[this.lineIndex].length ? 1 : 2)];
                    DiagnosticCollector.addDiagnostic(token.line, token.start, lastToken.end, "Expected ';'");
                }
                continue;
            }

            var toolDuration: number | undefined = undefined;
            if (tool.isOrderDetermined) blk: {
                for (var i = 0; i < tool.arguments.length; i++) {
                    const arg = tool.arguments[i];
                    if (arg.required) {
                        if (this.isNextType(TokenType.Semicolon)) {
                            const lastArgumentToken = this.tokens[this.lineIndex][this.tokenIndex - 2];
                            DiagnosticCollector.addDiagnostic(lastArgumentToken.line, lastArgumentToken.end, lastArgumentToken.end + 1, `Expected ${TokenType[arg.type].toLowerCase()}`);
                            break blk;
                        }

                        if (this.expectType(`Expected ${TokenType[arg.type].toLowerCase()}`, arg.type) !== undefined) {
                            this.validateArgument(arg);
                            if (i === tool.durationIndex)
                                toolDuration = +this.tokens[this.lineIndex][this.tokenIndex - 1].text;
                            continue;
                        }

                        // Skip arguments that are now not enabled
                        if (arg.enablesUpTo !== undefined) i = arg.enablesUpTo;
                    }
                    else {
                        if (this.isNextType(arg.type)) {
                            if (arg.type === TokenType.String && arg.text !== undefined) {
                                const token = this.tokens[this.lineIndex][this.tokenIndex - 1];
                                if (arg.text! === token.text) continue;

                                if (arg.enablesUpTo !== undefined) i = arg.enablesUpTo;
                                this.tokenIndex--;
                                continue;
                            }

                            this.validateArgument(arg);
                            if (i === tool.durationIndex)
                                toolDuration = +this.tokens[this.lineIndex][this.tokenIndex - 1].text;
                        }
                        else {
                            // Skip arguments that are now not enabled
                            if (arg.enablesUpTo !== undefined) i = arg.enablesUpTo;
                        }
                    }
                }

                if (tool.durationIndex === -1)
                    activeTools.push(new TASTool.Tool(toolName));
                else {
                    if (toolDuration !== undefined)
                        activeTools.push(new TASTool.Tool(toolName, toolDuration));
                }

                if (this.tokenIndex >= this.tokens[this.lineIndex].length) return;
                if (!this.isNextType(TokenType.Semicolon)) {
                    const token = this.currentToken();
                    this.moveToNextSemicolon();
                    // Display diagnostic from current token to the end of the token before the semicolon
                    DiagnosticCollector.addDiagnostic(token.line, token.start, this.tokens[this.lineIndex][this.tokenIndex - 2].end, "Expected ';'");
                    continue;
                }
            }
            else {
                while (this.tokenIndex < this.tokens[this.lineIndex].length && this.tokens[this.lineIndex][this.tokenIndex].type !== TokenType.Semicolon) {
                    const argument = this.currentToken();
                    blk: {
                        for (const arg of tool.arguments) {
                            if (arg.type === argument.type) {
                                if (argument.type === TokenType.String) {
                                    if (arg.text !== undefined && arg.text === argument.text)
                                        break blk;
                                }
                                else if (arg.type === TokenType.Number && arg.unit !== undefined) {
                                    if (this.tokenIndex + 1 < this.tokens[this.lineIndex].length) {
                                        this.tokenIndex++;
                                        if (this.isNextType(TokenType.String)) {
                                            this.tokenIndex--;
                                            const unitToken = this.tokens[this.lineIndex][this.tokenIndex];
                                            if (unitToken.text === arg.unit) break blk; // TODO: Maybe more information here?
                                        }
                                        this.tokenIndex--;
                                    }
                                }
                                else break blk;
                            }
                        }

                        DiagnosticCollector.addDiagnostic(argument.line, argument.start, argument.end, "Invalid argument");
                    }
                    this.tokenIndex++;
                }
                this.tokenIndex++;

                activeTools.push(new TASTool.Tool(toolName !== "decel" ? toolName : "(decel)", toolDuration));
            }
        }
    }

    private validateArgument(arg: TASTool.ToolArgument) {
        const argumentToken = this.tokens[this.lineIndex][this.tokenIndex - 1];
        if (arg.type === TokenType.String && arg.text !== undefined) {
            // Validate text
            if (arg.text !== argumentToken.text)
                DiagnosticCollector.addDiagnostic(argumentToken.line, argumentToken.start, argumentToken.end, "Invalid argument");
        }
        else if (arg.type === TokenType.Number && arg.unit !== undefined) {
            // Validate unit
            const isUnitOptional = arg.unit.endsWith("?");
            if (!this.isNextType(TokenType.String)) {
                if (!isUnitOptional)
                    DiagnosticCollector.addDiagnostic(argumentToken.line, argumentToken.end, argumentToken.end + 1, "Expected unit");
                return;
            }

            const unitToken = this.tokens[this.lineIndex][this.tokenIndex - 1];
            if (unitToken.text !== arg.unit.substring(0, arg.unit.length - 1))
                DiagnosticCollector.addDiagnostic(unitToken.line, unitToken.start, unitToken.end, "Invalid unit");
        }
    }

    private moveToNextSemicolon() {
        while (this.tokenIndex < this.tokens[this.lineIndex].length) {
            if (this.currentToken().type === TokenType.Semicolon) {
                this.tokenIndex++;
                return;
            }
            this.tokenIndex++;
        }
    }

    /*
    * Helpers
    */

    private currentToken(): Token {
        return this.tokens[this.lineIndex][this.tokenIndex];
    }

    private isNextType(type: TokenType): boolean {
        const token = this.maybeNext();
        if (token === undefined) return false;
        if (token.type === type)
            return true;
        else {
            this.tokenIndex--;
            return false;
        }
    }

    private expectType(errorText: string, ...types: TokenType[]): Token | undefined {
        const token = this.next(errorText);
        if (token === undefined) return;
        for (const opt of types) if (token.type === opt) return token;

        DiagnosticCollector.addDiagnostic(token.line, token.start, token.end, errorText);
    }

    private expectVector() {
        const hasVector = this.isNextType(TokenType.Number);
        if (!hasVector) return;
        this.expectType("Expected vector", TokenType.Number);
    }

    private next(errorText?: string): Token | undefined {
        const result = this.maybeNext();
        if (result === undefined) {
            const lastToken = this.tokens[this.lineIndex][this.tokens[this.lineIndex].length - 1];
            DiagnosticCollector.addDiagnosticToLine(lastToken.line, lastToken.end, errorText || "Expected token");
        }
        return result;
    }

    private maybeNext(): Token | undefined {
        const line = this.tokens[this.lineIndex];
        if (this.tokens[this.lineIndex].length <= this.tokenIndex)
            return undefined;

        return line[this.tokenIndex++];
    }

    private expectText(errorText: string, ...text: string[]): string | undefined {
        const token = this.next(errorText);
        if (token === undefined) return;

        if (token.type !== TokenType.String) {
            DiagnosticCollector.addDiagnostic(token.line, token.start, token.end, errorText);
            return undefined;
        }
        else if (text.length !== 0) blk: {
            for (const opt of text) if (token.text === opt) break blk;
            DiagnosticCollector.addDiagnostic(token.line, token.start, token.end, errorText);
            return undefined;
        }

        return token.text;
    }

    private expectNumber(errorText: string, ...number: number[]): number | undefined {
        const token = this.next();
        if (token === undefined) return;

        if (token.type !== TokenType.Number) {
            DiagnosticCollector.addDiagnostic(token.line, token.start, token.end, errorText);
            return;
        }

        const num = +token.text;
        if (number.length !== 0) blk: {
            for (const opt of number) if (num === opt) break blk;
            DiagnosticCollector.addDiagnostic(token.line, token.start, token.end, errorText);
            return;
        }

        return num;
    }

    private expectCount(errorText: string, count: number) {
        if (this.tokens[this.lineIndex].length === count) return;
        const firstInvalidToken = this.tokens[this.lineIndex][count];
        if (firstInvalidToken === undefined) return;
        DiagnosticCollector.addDiagnosticToLine(firstInvalidToken.line, firstInvalidToken.start, errorText);
    }

}

export enum LineType {
    Version,
    Start,
    RngManip,
    RepeatStart,
    End,
    Framebulk
}

export class ScriptLine {
    constructor(
        public lineText: string,
        public tick: number,
        public isRelative: boolean,
        public type: LineType,
        public activeTools: TASTool.Tool[],
        public tokens: Token[],
    ) { }
}