import { Diagnostic, integer } from "vscode-languageserver/node";
import { DiagnosticCollector } from "./diagnosticCollector";
import { TASTool } from "./tasTool";
import { Token, tokenize, TokenType } from "./tokenizer";

enum ParserState {
    Version, Start, RngManip, Framebulks
}

export class TASScript {
    fileText = "";

    // Map of line# -> ScriptLine
    lines = new Map<number, ScriptLine>();

    scriptVersion = 4;

    tokens: Token[][] = [];
    lineIndex = 0;
    tokenIndex = 0;

    private previousLine(): ScriptLine | undefined {
        const entries = Array.from(this.lines.entries());
        if (entries.length === 0) return undefined;

        var i = entries.length - 1;
        return entries[i][1];
    }

    parse(fileText?: string): Diagnostic[] {
        new DiagnosticCollector();

        if (fileText !== undefined) {
            this.fileText = fileText;
        }

        this.lineIndex = 0;
        this.tokenIndex = 0;
        this.lines = new Map<number, ScriptLine>();

        var lines: string[] = [];
        [this.tokens, lines] = tokenize(this.fileText);

        var state = ParserState.Version;
        var isFirstFramebulk = true;

        // Stack for nested repeats; stores iterations, starting tick, lineIndex of "repeat"
        var repeats: [number, number, number][] = [];

        while (this.lineIndex < this.tokens.length) {
            if (this.tokens[this.lineIndex].length === 0) {
                this.lineIndex++;
                continue;
            }

            const currentLine = this.tokens[this.lineIndex][0].line;
            const currentLineText = lines[currentLine];

            switch (state) {
                case ParserState.Version:
                    this.expectText("Expected version", "version");
                    this.scriptVersion = this.expectNumber("Invalid version", 1, 2, 3, 4, 5, 6, 7) ?? 7;
                    this.expectCount("Ignored parameters", 2);

                    this.lines.set(currentLine, new ScriptLine(currentLineText, 0, false, LineType.Version, [], this.tokens[this.lineIndex]));
                    state = ParserState.Start;
                    break;
                case ParserState.Start:
                    this.expectText("Expected start", "start");
                    const startType = this.expectText("Expected start type", "map", "save", "cm", "now", "next");

                    const checkStartTypeArgument = (startType: string, isNested: boolean) => {
                        if (startType !== "map" && startType !== "save" && startType !== "cm") return false;

                        var i = this.tokenIndex;
                        var tokenCount = 2;
                        var token1 = this.tokens[this.lineIndex][i];
                        var token2 = this.tokens[this.lineIndex][i + 1];
                        if (token1 === undefined && token2 === undefined) {
                            this.expectText("Expected parameter");
                            return;
                        }

                        // Accept tokens until there are no more, or two tokens are not adjacent
                        // E.g.: `1/2/3` - Parsed as separate tokens, but adjacent -> accepted
                        //       `1/2 3` - First three tokens accepted (^), fourth not adjacent -> error on fourth
                        while (true) {
                            if (token2 === undefined) return;
                            if (token1.end !== token2.start) {
                                this.expectCount("Ignored parameters", tokenCount + 1 + (isNested ? 1 : 0));
                            }

                            i++;
                            token1 = this.tokens[this.lineIndex][i];
                            token2 = this.tokens[this.lineIndex][i + 1];
                            tokenCount++;
                        }
                    };

                    if (startType !== undefined) {
                        if (startType === "next") {
                            const startType = this.expectText("Expected start type", "map", "save", "cm", "now");

                            if (startType !== undefined) {
                                if (startType === "now")
                                    this.expectCount("Ignored parameters", 3);
                                else
                                    checkStartTypeArgument(startType, true);
                            }
                        }
                        else {
                            if (startType === "now")
                                this.expectCount("Ignored parameters", 2);
                            else
                                checkStartTypeArgument(startType, false);
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
                    const prevLine = this.previousLine()!;

                    if (this.isNextType(TokenType.String)) {
                        const token = this.tokens[this.lineIndex][this.tokenIndex - 1];
                        if (token.text === "repeat") {
                            const tick = prevLine.tick;
                            const repeatCount = this.expectNumber("Expected repeat count");

                            if (repeatCount !== undefined)
                                repeats.push([repeatCount, tick, this.lineIndex]);
                            this.lines.set(currentLine, new ScriptLine(currentLineText, tick, false, LineType.RepeatStart, prevLine.activeTools, this.tokens[this.lineIndex]));
                            break;
                        }
                        else if (token.text === "end") {
                            var endTick = 0;
                            if (repeats.length === 0) {
                                DiagnosticCollector.addDiagnostic(token.line, token.start, token.end, "End outside of loop")
                                endTick = prevLine.tick;
                            }
                            else {
                                const [iterations, startingTick] = repeats.pop()!;
                                const repeatEnd = prevLine.tick;
                                endTick = prevLine.tick + (repeatEnd - startingTick) * (iterations - 1);
                            }
                            this.lines.set(currentLine, new ScriptLine(currentLineText, endTick, false, LineType.End, prevLine.activeTools, this.tokens[this.lineIndex]));
                            break;
                        }
                        else {
                            DiagnosticCollector.addDiagnostic(token.line, token.start, token.end, "Unexpected token");
                            this.lines.set(currentLine, new ScriptLine(currentLineText, -1, false, LineType.Framebulk, prevLine.activeTools, this.tokens[this.lineIndex]));
                            break;
                        }
                    }

                    const maybePlus = this.currentToken();
                    const isRelative = this.isNextType(TokenType.Plus);
                    if (isRelative && isFirstFramebulk)
                        DiagnosticCollector.addDiagnostic(maybePlus.line, maybePlus.start, maybePlus.end, "First framebulk cannot be relative");

                    const tickToken = this.currentToken();
                    const tick = this.expectNumber("Expected tick") || 0;

                    const angleToken = this.expectType("Expected '>' or '>>'", TokenType.RightAngle, TokenType.DoubleRightAngle);
                    const isToolBulk = angleToken !== undefined && angleToken.type === TokenType.DoubleRightAngle;

                    var activeTools = prevLine.activeTools.map((val) => val.copy());

                    var absoluteTick = isRelative ? prevLine.tick + tick : tick;
                    const previousLineTick = prevLine.tick;

                    if ((prevLine.type === LineType.Framebulk || prevLine.type === LineType.ToolBulk) && absoluteTick <= previousLineTick)
                        DiagnosticCollector.addDiagnostic(tickToken.line, tickToken.start, tickToken.end, `Expected tick greater than ${previousLineTick}`)

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
                        if (!isToolBulk) {
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

                    // Sort tools according to their priority index from SAR if version >= 3
                    if (this.scriptVersion >= 3)
                        activeTools.sort((a, b) => TASTool.tools[a.tool].index - TASTool.tools[b.tool].index);

                    this.lines.set(
                        currentLine,
                        new ScriptLine(
                            currentLineText,
                            absoluteTick,
                            isRelative,
                            !isToolBulk ? LineType.Framebulk : LineType.ToolBulk,
                            activeTools,
                            this.tokens[this.lineIndex]
                        )
                    );
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
        else if ((state === ParserState.RngManip || state === ParserState.Framebulks) && isFirstFramebulk) {
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
                var queue: TASTool.ToolArgument[] = [];

                var i = 0;
                while (true) {
                    if (i === tool.arguments.length && queue.length === 0) break;

                    var arg: TASTool.ToolArgument;
                    if (queue.length !== 0) {
                        arg = queue[0];
                        queue.splice(0, 1);
                    }
                    else {
                        arg = tool.arguments[i];
                        i++;
                    }

                    if (arg.required) {
                        if (arg.children !== undefined) queue.splice(0, 0, ...arg.children!);

                        if (this.isNextType(TokenType.Semicolon)) {
                            const lastArgumentToken = this.tokens[this.lineIndex][this.tokenIndex - 2];
                            DiagnosticCollector.addDiagnostic(lastArgumentToken.line, lastArgumentToken.end, lastArgumentToken.end + 1, `Expected ${TokenType[arg.type].toLowerCase()}`);
                            break blk;
                        }

                        if (this.expectType(`Expected ${TokenType[arg.type].toLowerCase()}`, arg.type) !== undefined) {
                            this.validateArgument(arg);
                            if (i === tool.durationIndex)
                                toolDuration = +this.tokens[this.lineIndex][this.tokenIndex - 1].text;
                        }
                    }
                    else {
                        if (this.isNextType(arg.type)) {
                            if (arg.type === TokenType.String && arg.text !== undefined) inner: {
                                const token = this.tokens[this.lineIndex][this.tokenIndex - 1];
                                if (arg.text! === token.text) break inner;

                                if (arg.otherwiseChildren !== undefined) queue.splice(0, 0, ...arg.otherwiseChildren!);
                                this.tokenIndex--;
                                continue;
                            }
                            else {
                                this.validateArgument(arg);
                            }

                            if (i === tool.durationIndex)
                                toolDuration = +this.tokens[this.lineIndex][this.tokenIndex - 1].text;

                            if (arg.children !== undefined) queue.splice(0, 0, ...arg.children!);
                            continue;
                        }

                        if (arg.otherwiseChildren !== undefined) queue.splice(0, 0, ...arg.otherwiseChildren!);
                    }
                }

                if (tool.durationIndex === -1) {
                    activeTools.push(new TASTool.Tool(
                        toolName,
                        this.lineIndex,
                        toolNameToken.start,
                        this.tokens[this.lineIndex][this.tokenIndex - 1].end,
                    ));
                } else {
                    if (toolName === "autoaim" || toolDuration !== undefined) {
                        activeTools.push(new TASTool.Tool(
                            toolName,
                            this.lineIndex,
                            toolNameToken.start,
                            this.tokens[this.lineIndex][this.tokenIndex - 1].end,
                            toolDuration,
                        ));
                    }
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

                activeTools.push(new TASTool.Tool(
                    toolName !== "decel" ? toolName : "(decel)",
                    this.lineIndex,
                    toolNameToken.start,
                    this.tokens[this.lineIndex][this.tokenIndex - 2].end,
                    toolDuration,
                ));
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
    Framebulk,
    ToolBulk,
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
