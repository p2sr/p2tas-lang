export enum TokenType {
    Plus, Number, RightAngle, Pipe, Semicolon, String, Whitespace,
    SingleLineComment,
    MultilineCommentOpen, MultilineCommentClose,
}

export class Token {
    constructor(
        public type: TokenType,
        public text: string,
        public line: number,
        public start: number,
        public end: number,
    ) { }
}

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
                if (multilineCommentStartLine === undefined || multilineCommentStartIndex === undefined) throw new Error("TODO: Comment was closed but never opened");
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
                case ResultType.InvalidCharacter: throw new Error(`tokenizer: InvalidCharacter (at: ${index}, line: ${lineNumber})`);
            }
        }
    }

    function next(): Result | undefined {
        if (index >= text.length) return new Result(ResultType.End);

        const start = index;
        const nextType = nextTokenType();
        if (nextType !== undefined) {
            if (nextType === TokenType.Whitespace) return undefined;

            const end = index;
            const tokenText = text.substring(start, end);
            return new Result(ResultType.Token, new Token(nextType, tokenText, lineNumber, start, end));
        }
        else {
            return new Result(ResultType.InvalidCharacter);
        }
    }

    function accept(predicate: (str: string) => boolean): boolean {
        if (index >= text.length) return false;

        const c = text[index];
        if (predicate(c)) {
            index++;
            return true;
        }
        return false;
    }

    function anyOf(chars: string): (str: string) => boolean {
        return (str: string): boolean => chars.indexOf(str) !== -1;
    }

    const whitespacePredicate = anyOf(" \n\r\t");
    const numberPredicate = anyOf("-0123456789");
    const letterPredicate = anyOf("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-1234567890");

    function nextTokenType(): TokenType | undefined {
        // Skip whitespace
        if (accept(whitespacePredicate)) {
            while (accept(whitespacePredicate));
            return TokenType.Whitespace;
        }

        // Accept number (including floats)
        if (accept(numberPredicate)) {
            while (accept(numberPredicate));
            accept(anyOf("."));
            while (accept(numberPredicate));
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
            case ">": return TokenType.RightAngle;
            case "|": return TokenType.Pipe;
            case ";": return TokenType.Semicolon;
            case "/":
                if (accept(anyOf("/"))) return TokenType.SingleLineComment;
                else if (accept(anyOf("*"))) return TokenType.MultilineCommentOpen;
                return undefined; // ?
            case "*":
                if (accept(anyOf("/"))) return TokenType.MultilineCommentClose;
                return undefined; // ?
            default: return undefined;
        }
    }

}