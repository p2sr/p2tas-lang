import { Diagnostic } from "vscode-languageserver/node";
import { DiagnosticCollector } from "./diagnosticCollector";
import { Token, tokenize, TokenType } from "./tokenizer";

enum ParserState {
    Version, Start, Framebulks
}

export class TASScript {

    lines: ScriptLine[] = [];

    tokens: Token[][] = [];
    lineIndex = 0;
    tokenIndex = 0;

    parse(fileText: string): Diagnostic[] {
        new DiagnosticCollector();

        this.lineIndex = 0;
        this.tokenIndex = 0;
        this.tokens = tokenize(fileText);

        var state = ParserState.Version;

        while (this.lineIndex < this.tokens.length) {
            if (this.tokens[this.lineIndex].length === 0) {
                this.lineIndex++;
                continue;
            }

            switch (state) {
                case ParserState.Version:
                    this.expectText("Expected version", "version");
                    this.expectNumber("Invalid version", 1, 2);
                    this.expectCount("Ignored parameters", 2);

                    this.lines.push(new ScriptLine(-1, false, LineType.Version));
                    state = ParserState.Start;
                    break;
                case ParserState.Start:
                    this.expectText("Expected start", "start");
                    const startType = this.expectText("Expected start type", "map", "save", "cm", "now", "next");

                    if (startType !== undefined) {
                        if (startType === "next") {
                            const startType = this.expectText("Expected start type", "map", "save", "cm", "now");

                            if (startType !== undefined) {
                                if (startType === "now")
                                    this.expectCount("Ignored parameters", 3);
                                else {
                                    this.expectText("Expected parameter");
                                    this.expectCount("Ignored parameters", 4);
                                }
                            }
                        }
                        else {
                            if (startType === "now")
                                this.expectCount("Ignored parameters", 2);
                            else {
                                this.expectText("Expected parameter");
                                this.expectCount("Ignored parameters", 3);
                            }
                        }
                    }

                    this.lines.push(new ScriptLine(-1, false, LineType.Start));
                    state = ParserState.Framebulks;
                    break;
                case ParserState.Framebulks:
                    const isRelative = this.isNextType(TokenType.Plus);
                    const tick = this.expectNumber("Expected tick") || 0;
                    this.expectType("Expected '>'", TokenType.RightAngle);

                    blk: {
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
                        this.tokenIndex++;
                        while (this.tokenIndex < this.tokens[this.lineIndex].length && this.currentToken().type !== TokenType.Pipe)
                            this.tokenIndex++;

                        this.tokenIndex++;
                        if (this.tokens[this.lineIndex].length <= this.tokenIndex) break blk;
                        
                        // Tools field
                        // TODO
                    }

                    this.lines.push(new ScriptLine(tick, isRelative, LineType.Framebulk));
                default:
                    break;
            }

            this.tokenIndex = 0;
            this.lineIndex++;
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

    /*
    * Helpers
    */

    private currentToken(): Token {
        return this.tokens[this.lineIndex][this.tokenIndex - 1];
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

    private expectType(errorText: string, type: TokenType) {
        const token = this.next(errorText);
        if (token === undefined) return;
        if (token.type !== type)
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
        DiagnosticCollector.addDiagnosticToLine(firstInvalidToken.line, firstInvalidToken.start, errorText);
    }

}

export enum LineType {
    Version, Start, RepeatStart, End, Framebulk
}

export class ScriptLine {
    constructor(
        public tick: number,
        public isRelative: boolean,
        public type: LineType,
    ) { }
}