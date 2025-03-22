import { Diagnostic, integer } from "vscode-languageserver/node";
import { DiagnosticCollector } from "./diagnosticCollector";
import { TASTool } from "./tasTool";
import { Token, tokenize, TokenType } from "./tokenizer";

/**
 * The state of the parser. The parser advances the state in the following way (trying to accept
 * the respective tokens or falling back to defaults): \
 * Version -> Start -> RngManip -> Framebulks
 */
enum ParserState {
    Version, Start, RngManip, Framebulks
}

/**
 * Parser for a TAS script, collecting useful information for the LSP.
 * Due to the nature of TAS scripts, this parser works as a state machine, first expecting a version
 * statement, then a start statement and finally framebulks.
 *
 * NOTE: The files this operates on are, in the majority of cases, incorrect/incomplete as the user is
 *       still working on them. This parser thus needs to be able to recover from errors and continue
 *       parsing as much as possible, even if errors have been encountered.
 */
export class TASScript {
    /** Default assumed script version */
    readonly DEFAULT_VERSION = 8;

    fileText = "";

    /** Map of line number to ScriptLine */
    lines = new Map<number, ScriptLine>();

    scriptVersion = this.DEFAULT_VERSION;

    tokens: Token[][] = [];
    lineIndex = 0;
    tokenIndex = 0;

    private previousLine(): ScriptLine | undefined {
        const entries = Array.from(this.lines.entries());
        if (entries.length === 0) return undefined;

        var i = entries.length - 1;
        return entries[i][1];
    }

    /** Parses the given file, extracting useful information into the `lines` field and returns diagnostic information. */
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
        /** Used to return diagnostic for when the first framebulk is relative. */
        var isFirstFramebulk = true;

        /** Stack for nested repeats; stores iterations, starting tick, lineIndex of "repeat". */
        var repeats: [number, number, number][] = [];

        while (this.lineIndex < this.tokens.length) {
            if (this.tokens[this.lineIndex].length === 0) {
                this.lineIndex++;
                continue;
            }

            const currentLine = this.tokens[this.lineIndex][0].line;
            const currentLineText = lines[currentLine];

            switch (state) {
                // Try to accept `version <number>`, falling back to DEFAULT_VERSION
                case ParserState.Version:
                    // Make sure a valid version is provided
                    this.expectText("Expected version", "version");
                    this.scriptVersion = this.expectNumber("Invalid version", 1, 2, 3, 4, 5, 6, 7, 8) ?? this.DEFAULT_VERSION;
                    this.expectCount("Ignored parameters", 2);

                    this.lines.set(currentLine, new ScriptLine(currentLineText, 0, false, LineType.Version, [], this.tokens[this.lineIndex]));
                    state = ParserState.Start;
                    break;
                // Try to accept `start [next] now` or `start [next] map/save/cm <map/save>`
                case ParserState.Start:
                    this.expectText("Expected start", "start");
                    const startType = this.expectText("Expected start type", "map", "save", "cm", "now", "next");

                    /** Accepts the path after map/save/cm start types. */
                    const acceptStartPathArgument = (startType: string) => {
                        if (startType !== "map" && startType !== "save" && startType !== "cm") return false;
                        const count = this.acceptConsecutiveTokens();
                        if (count === 0) {
                            const lastToken = this.tokens[this.lineIndex][this.tokenIndex - 1];
                            DiagnosticCollector.addDiagnosticToLine(lastToken.line, lastToken.end, "Expected arguments");
                        }
                    };

                    // Accept start statement + its arguments, as well as a map/save string if necessary
                    if (startType !== undefined) {
                        if (startType === "next") {
                            const startType = this.expectText("Expected start type", "map", "save", "cm", "now");

                            if (startType !== undefined) {
                                if (startType === "now")
                                    this.expectCount("Ignored parameters", 3);
                                else
                                    acceptStartPathArgument(startType);
                            }
                        }
                        else {
                            if (startType === "now")
                                this.expectCount("Ignored parameters", 2);
                            else
                                acceptStartPathArgument(startType);
                        }
                    }

                    this.lines.set(currentLine, new ScriptLine(currentLineText, 0, false, LineType.Start, [], this.tokens[this.lineIndex]));
                    state = ParserState.RngManip;
                    break;
                // Try to accept `rngmanip <path>`
                case ParserState.RngManip:
                    const token = this.next("Expected framebulks or rngmanip");
                    if (token === undefined) break;

                    if (token.type === TokenType.String && token.text === "rngmanip") {
                        const count = this.acceptConsecutiveTokens();
                        if (count === 0) {
                            const lastToken = this.tokens[this.lineIndex][this.tokenIndex - 1];
                            DiagnosticCollector.addDiagnosticToLine(lastToken.line, lastToken.end, "Expected arguments");
                        }
                    } else {
                        this.lineIndex--;
                    }
                    state = ParserState.Framebulks;
                    break;
                // Try to accept framebulks for the rest of the file
                case ParserState.Framebulks:
                    const prevLine = this.previousLine()!;

                    // Handle repeat/end
                    // i.e. `repeat <iterations> \n <framebulks> \n end`
                    if (this.isNextType(TokenType.String)) {
                        const token = this.tokens[this.lineIndex][this.tokenIndex - 1];
                        if (token.text === "repeat") {
                            const tick = prevLine.tick;
                            const repeatCount = this.expectNumber("Expected repeat count");

                            if (repeatCount !== undefined)
                                repeats.push([repeatCount, tick, this.lineIndex]);
                            this.lines.set(currentLine, new ScriptLine(currentLineText, tick, false, LineType.RepeatStart, prevLine.activeTools, this.tokens[this.lineIndex]));
                        }
                        // Handle repeat "end". The tick of the line that contains the "end" keyword is
                        // the tick that is reached after the loop is over.
                        else if (token.text === "end") {
                            var endTick = 0;
                            // Invalid end (no preceeding "repeat").
                            if (repeats.length === 0) {
                                DiagnosticCollector.addDiagnostic(token.line, token.start, token.end, "End outside of loop")
                                endTick = prevLine.tick;
                            }
                            // Calculate loop end tick. Since we processed the loop content, the last line of the repeat block will have the tick
                            // that is reached after one iteration. Therefore, we have to multiply the duration of the loop with the iterations
                            // minus 1 to get the remaining duration of the loop after one iteration. The duration of the loop can be calculated
                            // using the tick of the "repeat" line.
                            else {
                                const [iterations, startingTick] = repeats.pop()!;
                                const repeatEnd = prevLine.tick;
                                endTick = prevLine.tick + (repeatEnd - startingTick) * (iterations - 1);
                            }
                            this.lines.set(currentLine, new ScriptLine(currentLineText, endTick, false, LineType.End, prevLine.activeTools, this.tokens[this.lineIndex]));
                        }
                        else {
                            DiagnosticCollector.addDiagnostic(token.line, token.start, token.end, "Unexpected token");
                            this.lines.set(currentLine, new ScriptLine(currentLineText, -1, false, LineType.Framebulk, prevLine.activeTools, this.tokens[this.lineIndex]));
                        }

                        break;
                    }

                    // Parse framebulks

                    // Check whether the framebulk is relative ('+' before the tick); the first framebulk cannot be relative!
                    const maybePlus = this.currentToken();
                    const isRelative = this.isNextType(TokenType.Plus);
                    if (isRelative && isFirstFramebulk)
                        DiagnosticCollector.addDiagnostic(maybePlus.line, maybePlus.start, maybePlus.end, "First framebulk cannot be relative");

                    const tickToken = this.currentToken();
                    const tick = this.expectNumber("Expected tick") || 0;

                    var absoluteTick = isRelative ? prevLine.tick + tick : tick;
                    const previousLineTick = prevLine.tick;

                    if ((prevLine.type === LineType.Framebulk || prevLine.type === LineType.ToolBulk) && absoluteTick <= previousLineTick)
                        DiagnosticCollector.addDiagnostic(tickToken.line, tickToken.start, tickToken.end, `Expected tick greater than ${previousLineTick}`)

                    const angleToken = this.expectType("Expected '>' or '>>'", TokenType.RightAngle, TokenType.DoubleRightAngle);
                    const isToolBulk = angleToken !== undefined && angleToken.type === TokenType.DoubleRightAngle;

                    // Deep copy the previous line's active tools, so that we can modify it independently
                    var activeTools = prevLine.activeTools.map((val) => val.copy());

                    // Update `activeTools` by updating `ticksRemaining` and removing tools that are no longer active
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

            if (this.tokenIndex < this.tokens[this.lineIndex].length) {
                const lastToken = this.currentToken();
                DiagnosticCollector.addDiagnosticToLine(lastToken.line, lastToken.start, "Unexpected tokens");
            }

            this.tokenIndex = 0;
            this.lineIndex++;
        }

        // No tokens left => check what the user is missing
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

    /**
     * Accepts any number of consecutive tokens in the current line and returns how many were accepted.
     *
     * Example:
     * `1/2/3` - Tokenized as separate tokens, but consecutive - accepted! \
     * `1/2 3` - First three tokens are accepted, the fourth token is not adjacent - only three tokens accepted.
     */
    private acceptConsecutiveTokens(): number {
        var token1 = this.maybeNext();
        if (token1 === undefined) return 0;
        var token2 = this.maybeNext();
        if (token2 === undefined) return 1;

        var count = 2;
        while (true) {
            // Return `count - 1`, since we didn't actually accept the last token (`token2`)
            if (token2 === undefined) return count - 1;
            if (token1.end !== token2.start) {
                this.tokenIndex--;
                return count - 1;
            }

            token1 = token2;
            token2 = this.maybeNext();
            count++;
        }
    }


    private parseButtonsField() {
        if (this.tokens[this.lineIndex].length <= this.tokenIndex) return;
        if (this.isNextType(TokenType.Pipe)) {
            // Decrement `tokenIndex` to allow the caller to accept the pipe themselves, since this is
            // simply the indication for us that there is nothing to do here.
            this.tokenIndex--;
            return;
        }

        const buttons = this.expectText("Expected buttons") || "";
        const token = this.currentToken();
        // Collect button information, each button being followed by an optional hold duration (e.g. "J1")
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

    /** Parse tools and their arguments starting at `this.tokenIndex` and insert them into `activeTools`. */
    private parseToolsField(activeTools: TASTool.Tool[]) {
        while (this.tokens[this.lineIndex].length > this.tokenIndex) {
            if (this.isNextType(TokenType.Semicolon)) continue;

            // Expect and verify the tool's name
            const toolName = this.expectText("Expected tool");
            const toolNameToken = this.tokens[this.lineIndex][this.tokenIndex - 1];
            if (toolName === undefined || !TASTool.tools.hasOwnProperty(toolName)) {
                DiagnosticCollector.addDiagnostic(toolNameToken.line, toolNameToken.start, toolNameToken.end, "Invalid tool");
                this.moveToNextSemicolon();
                continue;
            }

            // Write an error if the tool expects arguments but got none
            if ((this.isNextType(TokenType.Semicolon) || this.tokenIndex >= this.tokens[this.lineIndex].length) && TASTool.tools[toolName].expectsArguments) {
                DiagnosticCollector.addDiagnosticToLine(toolNameToken.line, toolNameToken.end, "Expected arguments");
                this.tokenIndex++;
                continue;
            }

            // Remove the tool from `activeTools` if it is already present, as we'll re-add it with updated parameters
            const toolIndex = activeTools.findIndex((val) => val.tool === toolName || val.tool === `(${toolName})`);
            if (toolIndex !== -1) activeTools.splice(toolIndex, 1);

            const tool = TASTool.tools[toolName];
            const firstArgument = this.tokens[this.lineIndex][this.tokenIndex];
            // If the tool has an "off" argument, it should be the first and only argument given to the tool
            if (tool.hasOff && firstArgument.type === TokenType.String && firstArgument.text === "off") {
                this.tokenIndex++;
                if (this.tokenIndex >= this.tokens[this.lineIndex].length) return;
                // Consume everything up to the next semicolon if there are more arguments after the "off" argument
                // and emit diagnostics accordingly
                if (!this.isNextType(TokenType.Semicolon)) {
                    const token = this.currentToken();
                    this.moveToNextSemicolon();
                    DiagnosticCollector.addDiagnosticToLine(token.line, token.start, "Expected ';'");
                }
                continue;
            }

            var toolDuration: number | undefined = undefined;
            if (tool.hasFixedOrder) blk: {
                // Expect the tool arguments in the order they were defined in `tool.arguments`, as they have to appear in this order.

                /**
                 * Arguments that need to come next (used to parse argument children before other arguments). This is emptied first,
                 * before continuing with `tool.arguments`
                 */
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

                                // The argument wasn't matched => expect the argument's otherwiseChildren next
                                if (arg.otherwiseChildren !== undefined) queue.splice(0, 0, ...arg.otherwiseChildren!);
                                // Backtrack, since the argument wasn't matched
                                this.tokenIndex--;
                                continue;
                            }
                            else {
                                this.validateArgument(arg);
                            }

                            // Extract the tools duration
                            if (i === tool.durationIndex)
                                toolDuration = +this.tokens[this.lineIndex][this.tokenIndex - 1].text;

                            if (arg.children !== undefined) queue.splice(0, 0, ...arg.children!);
                            continue;
                        }

                        // The argument wasn't matched => expect the argument's otherwiseChildren next
                        if (arg.otherwiseChildren !== undefined) queue.splice(0, 0, ...arg.otherwiseChildren!);
                    }
                }

                // Update `activeTools` with the new tool
                if (tool.durationIndex === -1) {
                    activeTools.push(new TASTool.Tool(
                        toolName,
                        this.lineIndex,
                        toolNameToken.start,
                        this.tokens[this.lineIndex][this.tokenIndex - 1].end,
                    ));
                } else {
                    // FIXME: autoaim's duration argument is optional, and if not supplied, autoaim will stay active until manually
                    //        turned off. However, since it has a durationIndex, we are not handling it above. This should be handled
                    //        in a more general way.
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

                // Since we have matched all arguments of the tool, the tool usage should end here (either by semicolon or by the end of the line)
                if (this.tokenIndex >= this.tokens[this.lineIndex].length) return;
                // If the next token is not a semicolon, there is more invalid text after the tool has been given all its arguments
                if (!this.isNextType(TokenType.Semicolon)) {
                    const token = this.currentToken();
                    this.moveToNextSemicolon();
                    // Display diagnostic from current token to the end of the token before the semicolon
                    DiagnosticCollector.addDiagnostic(token.line, token.start, this.tokens[this.lineIndex][this.tokenIndex - 2].end, "Expected ';'");
                    continue;
                }
            }
            else {
                // Accept the tool arguments in any order

                // But, only do it if the tool actually has arguments!
                if (tool.arguments.length > 0) {
                    while (this.tokenIndex < this.tokens[this.lineIndex].length && this.tokens[this.lineIndex][this.tokenIndex].type !== TokenType.Semicolon) {
                        const argumentToken = this.currentToken();
                        blk: {
                            // Try to find an argument that matches
                            for (const toolArg of tool.arguments) {
                                if (toolArg.type === argumentToken.type) {
                                    if (argumentToken.type === TokenType.String) {
                                        if (toolArg.text !== undefined && toolArg.text === argumentToken.text)
                                            break blk;
                                    }
                                    else if (toolArg.type === TokenType.Number && toolArg.unit !== undefined) {
                                        if (this.tokenIndex + 1 < this.tokens[this.lineIndex].length) {
                                            // Increment the `tokenIndex` briefly to check the token's type after the argument
                                            // (`tokenIndex` is pointing at the number)
                                            this.tokenIndex++;
                                            if (this.isNextType(TokenType.String)) {
                                                this.tokenIndex--;
                                                const unitToken = this.tokens[this.lineIndex][this.tokenIndex];
                                                // TODO: Emit diagnostics for incorrect units.
                                                if (unitToken.text === toolArg.unit) break blk;
                                            }
                                            // Decrement again, since the argument didn't match and we need to check the next
                                            // argument using the loop
                                            this.tokenIndex--;
                                        }
                                    }
                                    else break blk;
                                }
                            }

                            // Couldn't find a matching argument
                            DiagnosticCollector.addDiagnostic(argumentToken.line, argumentToken.start, argumentToken.end, "Invalid argument");
                        }
                        this.tokenIndex++;
                    }

                    this.tokenIndex++;
                }

                // Update `activeTools` with the new tool
                activeTools.push(new TASTool.Tool(
                    // TODO: No special case for "decel" tool?!
                    toolName !== "decel" ? toolName : "(decel)",
                    this.lineIndex,
                    toolNameToken.start,
                    this.tokens[this.lineIndex][this.tokenIndex - 2].end,
                    toolDuration,
                ));
            }
        }
    }

    /**
     * Emits diagnostics for the argument before `tokenIndex`.
     * Checks that the text matches the given argument or that the corresponding number has the right unit attached to it.
     */
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

            // Define what the unit is supposed to be
            const unitToken = this.tokens[this.lineIndex][this.tokenIndex - 1];
            // Find out what the unit provided in the TAS file actually is
            // This must be cut off if the unit is optional, to avoid accidentally requiring the question mark.
            const providedUnit = isUnitOptional ? arg.unit.substring(0, arg.unit.length - 1) : arg.unit;

            if (unitToken.text !== providedUnit)
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

    /**
     * Return a token if it matches any of `types`, or undefined, in which case a diagnostic with the
     * given `errorText` will be created at the erroneous token.
     */
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

    /**
     * Return a string if the next token is of `TokenType.String` and matches a text from `text`, or undefined,
     * in which case a diagnostic with the given `errorText` will be created at the erroneous token.
     */
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

    /**
     * Return a number if the next token is of `TokenType.Number` and matches a number from `number`, or undefined,
     * in which case a diagnostic with the given `errorText` will be created at the erroneous token.
     */
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

    /**
     * Expect there to be `count` tokens in the current line, or emit a diagnostic from the last valid (fitting in count) token
     * to the end of the line.
    */
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

/** Information about a line in the TAS script. */
export class ScriptLine {
    constructor(
        /**  The raw text of the line. */
        public lineText: string,
        /**  The absolute tick of the line in the script. */
        public tick: number,
        /**  Whether the tick of the line is relative. */
        public isRelative: boolean,
        public type: LineType,
        /**  Which tools are active at this line. */
        public activeTools: TASTool.Tool[],
        public tokens: Token[],
    ) { }
}
