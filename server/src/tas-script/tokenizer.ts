//! Tokenizer, capable of tokenizing TAS scripts. It also removes comments from tokenized scripts,
//! meaning they don't appear in the output at all.

import { DiagnosticCollector } from "./diagnosticCollector";

export enum TokenType {
    Plus, Number, RightAngle, DoubleRightAngle, Pipe, Semicolon, String, Whitespace,
    SingleLineComment,
    MultilineCommentOpen, MultilineCommentClose,
}

export class Token {
    constructor(
        public type: TokenType,
        /** The raw text of the token. */
        public text: string,
        public line: number,
        /** Start column. */
        public start: number,
        /** End column. */
        public end: number,
    ) { }
}

/**
 * Tokenizes a file given by `fileText` and returns the tokens and lines of the file.
 * The tokens are returned as a two-dimensional array, where the first dimension is the line in
 * the file the token is in and the second-dimension containing the tokens themselves.
 */
export function tokenize(fileText: string): [Token[][], string[]] {
    var tokens: Token[][] = [];

    var lines = fileText.split("\n");
    var lineIndex = 0;
    for (const line of lines) {
        tokens.push(Tokenizer.tokenizeLine(line, lineIndex));
        lineIndex++;
    }

    removeComments(tokens);
    return [tokens, lines];
}

/**
 * Removes all tokens in comments (single line and multiline). This will also emit diagnostics
 * for any unclosed or unopened multiline comments.
 */
function removeComments(tokens: Token[][]) {
    var lineIndex = 0;
    var tokenIndex = 0;

    var multilineCommentStartLine: number | undefined = undefined;
    var multilineCommentStartIndex: number | undefined = undefined;

    while (lineIndex < tokens.length) {
        const lineTokens = tokens[lineIndex];
        while (tokenIndex < lineTokens.length) {
            const token = lineTokens[tokenIndex];
            if (token.type === TokenType.MultilineCommentOpen) {
                multilineCommentStartLine = lineIndex;
                multilineCommentStartIndex = tokenIndex;
            }
            else if (token.type === TokenType.MultilineCommentClose) {
                if (multilineCommentStartLine === undefined || multilineCommentStartIndex === undefined) {
                    DiagnosticCollector.addDiagnostic(token.line, token.start, token.end, "Unmatched multiline comment close");
                    tokens[lineIndex].splice(tokenIndex, 1);
                    continue;
                }

                if (lineIndex === multilineCommentStartLine) {
                    tokens[lineIndex].splice(multilineCommentStartIndex, tokenIndex - multilineCommentStartIndex + 1)
                    tokenIndex = multilineCommentStartIndex;
                }
                else {
                    if (lineIndex !== multilineCommentStartLine + 1) {
                        const deleteCount = lineIndex - multilineCommentStartLine - 1;
                        lineIndex -= deleteCount;
                        tokens.splice(multilineCommentStartLine + 1, deleteCount);
                    }

                    tokens[multilineCommentStartLine].splice(multilineCommentStartIndex, tokens[multilineCommentStartLine].length);
                    tokens[lineIndex].splice(0, tokenIndex + 1);
                    tokenIndex = 0
                }
                multilineCommentStartLine = undefined;
                multilineCommentStartIndex = undefined;
                continue;
            }
            else if (token.type === TokenType.SingleLineComment) {
                tokens[lineIndex].splice(tokenIndex, tokens[lineIndex].length - tokenIndex + 1);
                if (tokenIndex === 0) break;
                tokenIndex--;
                continue;
            }

            tokenIndex++;
        }

        tokenIndex = 0;
        lineIndex++;
    }
}

namespace Tokenizer {

    enum ResultType {
        End, Token, InvalidCharacter
    }

    class Result {
        constructor(
            public type: ResultType,
            public token?: Token
        ) { }
    }

    var index: number = 0;
    var lineNumber: number = 0;
    var text: string = "";

    /** Tokenizes a single line of a script and returns the tokens of that line. */
    export function tokenizeLine(lineText: string, ln: number): Token[] {
        index = 0;
        lineNumber = ln;
        text = lineText;

        var tokens: Token[] = [];

        while (true) {
            const result = next();
            if (result === undefined) continue;

            switch (result.type) {
                case ResultType.End: return tokens;
                case ResultType.Token:
                    tokens.push(result.token!);
                    break;
            }
        }
    }

    /** Advances `index` past the next token and return a result, consisting of either an EOF or a `Token`. */
    function next(): Result | undefined {
        if (index >= text.length) return new Result(ResultType.End);

        const start = index;
        const nextType = nextTokenType();
        if (nextType === TokenType.Whitespace) return undefined;

        const end = index;
        const tokenText = text.substring(start, end);
        return new Result(ResultType.Token, new Token(nextType, tokenText, lineNumber, start, end));
    }

    /**
     * Function predicate to determine whether a character should be accepted. Note that
     * JavaScript doesn't have "chars", so this is passed a string of length 1.
     */
    type Predicate = (str: string) => boolean;

    /**
     * Takes a `predicate` and returns whether it accepts the current character in `text`. If it does,
     * it advances the character index, meaning consecutive calls to `accept()` will consume more and
     * more of the tokenizer's input string.
     */
    function accept(predicate: Predicate): boolean {
        if (index >= text.length) return false;

        const c = text[index];
        if (predicate(c)) {
            index++;
            return true;
        }
        return false;
    }

    /** Return a `Predicate` that accepts any character in `chars`. */
    function anyOf(chars: string): Predicate {
        return (str: string): boolean => chars.indexOf(str) !== -1;
    }

    const whitespacePredicate = anyOf(" \n\r\t");
    const numberPredicate = anyOf("-0123456789");
    const letterPredicate = anyOf("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-0123456789:().\"\'=@[]");

    /** Advance `index` past the next token and return the corresponding `TokenType`. */
    function nextTokenType(): TokenType {
        // Skip whitespace
        if (accept(whitespacePredicate)) {
            while (accept(whitespacePredicate));
            return TokenType.Whitespace;
        }

        // Accept number (including floats)
        if (accept(anyOf("-.0123456789"))) {
            while (accept(numberPredicate));
            accept(anyOf("."));
            while (accept(numberPredicate));

            if (accept(anyOf("e"))) {
                if (!accept(numberPredicate)) return TokenType.String;
                while (accept(numberPredicate));
            }

            return TokenType.Number;
        }

        // Accept words
        if (accept(letterPredicate)) {
            while (accept(letterPredicate));
            return TokenType.String;
        }

        // Accept other tokens
        const c = text[index];
        index++;

        switch (c) {
            case "+": return TokenType.Plus;
            case ">":
                if (accept(anyOf(">"))) return TokenType.DoubleRightAngle;
                else return TokenType.RightAngle;
            case "|": return TokenType.Pipe;
            case ";": return TokenType.Semicolon;
            case "/":
                if (accept(anyOf("/"))) return TokenType.SingleLineComment;
                else if (accept(anyOf("*"))) return TokenType.MultilineCommentOpen;
                return TokenType.String;
            case "*":
                if (accept(anyOf("/"))) return TokenType.MultilineCommentClose;
                return TokenType.String;
            default: return TokenType.String;
        }
    }

}