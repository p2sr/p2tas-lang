import * as vscode from 'vscode';
import { TASServer } from './TASServer';
import { TASSidebarProvider } from './sidebar';

export var server: TASServer;

const tokens: { [command: string]: string[]; } = {
    "start": ["now","save","map","next","cm"],
    "autojump": ["on","off"],
    "absmov": ["off"],
    "strafe": ["none","off","vec","ang","veccam","max","keep","forward","forwardvel","left","right","nopitchlock"],
    "setang": [],
    "autoaim": ["off"],
    "decel": ["off"]
};

const activeToolsDisplayDecorationType = vscode.window.createTextEditorDecorationType({
    after: {
        color: new vscode.ThemeColor("tab.inactiveForeground"),
        margin: "10px"
    }
});

var activeToolsDisplayDecoration: vscode.DecorationOptions & vscode.DecorationRenderOptions = {
    range: new vscode.Range(new vscode.Position(0, 0),
        (vscode.window.activeTextEditor?.document?.lineAt(0)?.range?.end || new vscode.Position(0, 0)))
}

export function activate(context: vscode.ExtensionContext) {

    server = new TASServer();

	const tool_keyword_provider = vscode.languages.registerCompletionItemProvider('p2tas', {

		provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext) {

            let completionItems = [];
            for (const command in tokens) {
                completionItems.push(new vscode.CompletionItem(command));
            }

			// return all completion items as array
			return completionItems;
		}
	});
    
    context.subscriptions.push(tool_keyword_provider);

    for (const command in tokens) {
        let provider = vscode.languages.registerCompletionItemProvider('p2tas',
            {
                provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {

                    const linePrefix = document.lineAt(position).text.substr(0, position.character);
                    if (!linePrefix.endsWith(command + " ")) {
                        return undefined;
                    }

                    let completions = [];
                    for (const arg_idx in tokens[command]) {
                        completions.push(new vscode.CompletionItem(tokens[command][arg_idx], vscode.CompletionItemKind.Method));
                    }
    
                    return completions;
                }
            },
            ' '
        );

        context.subscriptions.push(provider);
    }

    const hoverProvider = vscode.languages.registerHoverProvider('p2tas', {
        provideHover(document: vscode.TextDocument, position: vscode.Position) {
            const hoveredLineText = document.lineAt(position.line).text.trim();

            if (!hoveredLineText.startsWith('//') && position.character < hoveredLineText.indexOf('>')) {
                const [tick, loopStartTick] = getTickForLine(position.line, document);
                return {
                    contents: [`Tick: ${tick}${loopStartTick !== undefined ? ` (Repeat start: ${loopStartTick})` : ""}`]
                };
            }

            return {
                contents: []
            };
        }
    });

    context.subscriptions.push(hoverProvider);

    vscode.commands.registerCommand("p2tas-lang.relativeFromAbsoluteTick", async () => {
        var editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage("No currently active editor");
            return;
        };

        const input = await vscode.window.showInputBox({ placeHolder: "Absolute Tick", ignoreFocusOut: true });
        if (!input) return;

        const inputTick = +input;
        if (!inputTick) {
            vscode.window.showErrorMessage("Please input a valid number!");
            return;
        }

        editor.edit(editBuilder => {
            const cursorPos = editor!.selection.active;
            var previousFramebulk = cursorPos.line;

            const [previousFramebulkTick, loopStartTick] = getTickForLine(previousFramebulk, editor!.document);
            if (loopStartTick) {
                // Command was used inside a repeat block. Cancelling
                vscode.window.showErrorMessage("This command can't be used inside a repeat block.")
                return;
            }

            const newTick = inputTick - previousFramebulkTick;

            if (newTick <= 0) {
                vscode.window.showErrorMessage(`Expected tick greater than ${previousFramebulkTick}`);
                return;
            }

            // Insert if there is no selection, otherwise, replace
            if (editor!.selection.isEmpty) editBuilder.insert(cursorPos, `+${newTick.toString()}>||||`);
            else editBuilder.replace(editor!.selection, `+${newTick.toString()}>||||`);
        });
    });

    // Variable used to not refresh multiple times on the same line in onDidChangeTextEditorSelection
    var previousLine = -1;

    vscode.window.onDidChangeTextEditorSelection(event => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const cursorPos = event.selections[0].active;

        if (previousLine === cursorPos.line) {
            // Refresh the ticks if you change your selection before the '>' !!!UNOPTIMISED!!!!
            if (cursorPos.character <= editor.document.lineAt(cursorPos.line).text.indexOf('>')) {
                // FIXME: Maybe don't re-compute everything when something is changed
                drawActiveToolsDisplay(cursorPos, editor.document);
                return;
            }
            else return;
        }

        drawActiveToolsDisplay(cursorPos, editor.document);
        previousLine = cursorPos.line;
    });

    drawActiveToolsDisplay(vscode.window.activeTextEditor!.selection.active, vscode.window.activeTextEditor!.document);

    // --------------------------------------------------------------------------------------------------
    //                                             Sockets
    // --------------------------------------------------------------------------------------------------

    vscode.commands.registerCommand("p2tas-lang.connectSAR", () => server.connect());
    vscode.commands.registerCommand("p2tas-lang.disconnectSAR", () => server.disconnect());
    vscode.commands.registerCommand("p2tas-lang.playTAS", () => server.requestPlayback());
    vscode.commands.registerCommand("p2tas-lang.stopTAS", () => server.requestStopPlayback());
    vscode.commands.registerCommand("p2tas-lang.changeRate", async () => {
        const input = await vscode.window.showInputBox({ placeHolder: "Desired rate", ignoreFocusOut: true });
        if (!input) return;
        const rate = +input;
        server.requestRatePlayback(rate);
    });
    vscode.commands.registerCommand("p2tas-lang.resumeTAS", () => server.requestStatePlaying());
    vscode.commands.registerCommand("p2tas-lang.pauseTAS", () => server.requestStatePaused());
    vscode.commands.registerCommand("p2tas-lang.fastForward", async () => {
        const input = await vscode.window.showInputBox({ placeHolder: "Fast forward to tick", ignoreFocusOut: true });
        if (!input) return;
        const tick = +input;
        server.requestFastForward(tick, false);
    });
    vscode.commands.registerCommand("p2tas-lang.setNextPauseTick", async () => {
        const input = await vscode.window.showInputBox({ placeHolder: "Pause at tick", ignoreFocusOut: true });
        if (!input) return;
        const tick = +input;
        server.requestNextPauseTick(tick);
    });
    vscode.commands.registerCommand("p2tas-lang.advanceTick", () => server.requestTickAdvance());


    // --------------------------------------------------------------------------------------------------
    //                                             Sidebar
    // --------------------------------------------------------------------------------------------------

    const sidebarProvider = new TASSidebarProvider(context.extensionUri, server);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        "p2tas-sidebar",
        sidebarProvider
      )
    );

}

function drawActiveToolsDisplay(cursorPos: vscode.Position, document: vscode.TextDocument) {
    const tools = getToolsForLine(cursorPos.line, document).join(', ');
    activeToolsDisplayDecoration = {
        range: new vscode.Range(cursorPos, document.lineAt(cursorPos.line).range.end),
        renderOptions: {
            after: {
                contentText: tools.length > 0 ? `Active tools: ${tools}` : "",
                textDecoration: ";font-size:11px",
                fontWeight: ";font-weight:lighter"
            }
        }
    };
    vscode.window.activeTextEditor!.setDecorations(activeToolsDisplayDecorationType, [activeToolsDisplayDecoration]);
}

function getToolsForLine(line: number, document: vscode.TextDocument): string[] {
    // Helper class used to count ticks, e.g. for lerped setang.
    // ticksRemaining is decreased every framebulk, depending it's value.
    // After it has reached 0, the index-th element of the result array is removed.
    class Counter {
        index: number;
        startTick: number;
        totalTicks: number;
        ticksRemaining: number;

        constructor(index: number, startTick: number, ticks: number) {
            this.index = index;
            this.startTick = startTick;
            this.totalTicks = ticks;
            this.ticksRemaining = ticks;
        }
    }

    function decrementCounters(decrement: (counter: Counter) => void) {
        for (var i = 0; i < counters.length; i++) {
            const counter = counters[i];
            decrement(counter);

            // Remove counter since it reached 0
            if (counter.ticksRemaining <= 0) {
                // Don't remove the result since autoaim doesn't turn off automatically
                if (result[counter.index] === "autoaim")
                    counters.splice(i, 1);
                else
                    // removeResult removes the counter as well
                    removeResult(counter.index);

                i--;
            }
        }
    }

    function removeResult(index: number) {
        result.splice(index, 1);
        for (var i = 0; i < counters.length; i++) {
            if (counters[i].index > index) counters[i].index--;
            else if (counters[i].index === index) counters.splice(i, 1);
        }
    }

    var result: string[] = [];
    var counters: Counter[] = [];
    var multilineCommentsOpen = 0;
    var repeatIterations: number | undefined = undefined;
    var repeatDuration = 0;
    for (let i = 0; i <= line; i++) {
        var lineText = document.lineAt(i).text.trim();
        if (lineText.startsWith('start') || lineText.startsWith('//') || lineText.length === 0) continue;

        [lineText, multilineCommentsOpen] = withMultilineComments(lineText, multilineCommentsOpen, i, true);
        if (multilineCommentsOpen > 0 || lineText.length === 0) continue;

        if (lineText.startsWith('repeat')) {
            const iterations = +lineText.substring(6);
            if (iterations === 0) {
                // Skip to the end of the loop, since it has 0 iterations
                while (!document.lineAt(++i).text.trim().startsWith('end') && i >= line);
                continue;
            }
            else {
                repeatIterations = iterations;
                // Move to next line
                continue;
            }
        }
        else if (lineText.startsWith('end')) {
            if (repeatIterations) {
                let amount = repeatDuration * repeatIterations;
                decrementCounters((counter) => counter.ticksRemaining -= amount);
            }

            repeatIterations = undefined;
            repeatDuration = 0;

            // Move to next line
            continue;
        }

        if (repeatIterations)
            repeatDuration += +lineText.substring(1, lineText.indexOf('>'));
        else {
            let amount = lineText.startsWith('+') ? +lineText.substring(1, lineText.indexOf('>')) : undefined;
            decrementCounters((counter) => {
                if (amount) counter.ticksRemaining -= amount;
                else counter.ticksRemaining = counter.totalTicks - (+lineText.substring(0, lineText.indexOf('>')) - counter.startTick);
            });
        }

        // We need to decrement the counters, changes in the line you are hovering over should be ignored
        if (i === line) break;

        // Only if the line has four "|" in it
        if (lineText.split("|").length - 1 === 4) {
            const tools = lineText.substring(lineText.lastIndexOf('|') + 1).split(';').map((value, index) => value.trim());
            for (const tool of tools) {
                // Tool arguments e.g.: [autoaim, off]
                const args = tool.split(' ');
                if (args.length < 2) continue;

                if (args[0] === "setang") {
                    if (args.length > 4) continue;

                    counters.push(new Counter(result.length, getTickForLine(i, document)[0], +(args[args.length - 1])));
                    result.push(args[0]);
                    continue;
                }
                else if (args[0] === "autoaim" && args.length === 5) {
                    counters.push(new Counter(result.length, getTickForLine(i, document)[0], +(args[args.length - 1])));
                    result.push(args[0]);
                    continue;
                }
                else if (args[0] === "decel") {
                    if (result.indexOf(args[0]) === -1)
                        result.push(`(${args[0]})`);
                    continue;
                }

                if (args[1] === "off")
                    // Remove tool from the list
                    removeResult(result.indexOf(args[0]));
                else {
                    // Tool is already in the list
                    if (result.indexOf(args[0]) !== -1) continue;
                    result.push(args[0]);
                }
            }
        }
    }

    for (var counter of counters)
        result[counter.index] += ` (${counter.ticksRemaining} ticks left)`;

    return result;
}

// Returns the tick count and the tick count of the start of a repeat block
// FIXME: This is dumb
function getTickForLine(line: number, document: vscode.TextDocument): [number, number | undefined] {
    const targetLine = document.lineAt(line).text.trim();

    if (targetLine.trim().length !== 0 && !targetLine.startsWith('+'))
        return [+targetLine.substring(0, targetLine.indexOf('>')), undefined];

    var tickCount = 0;
    var loopStartTick = undefined;
    var startedOutsideOfLoop = false;
    var multilineCommentsOpen = 0;
    for (var i = line; i >= 0; i--) {
        var lineText = document.lineAt(i).text.trim();
        if (lineText.startsWith('start') || lineText.startsWith('//') || lineText.length === 0) continue;

        [lineText, multilineCommentsOpen] = withMultilineComments(lineText, multilineCommentsOpen, i);
        if (multilineCommentsOpen > 0 || lineText.length === 0) continue;

        if (lineText.startsWith('end')) {
            startedOutsideOfLoop = true;
            
            const [ticksPassingInLoop, indexOfRepeatStatement] = getTicksPassingLoop(document, i);
            // Continue after the loop
            i = indexOfRepeatStatement;
            tickCount += ticksPassingInLoop;
            continue;
        }
        else if (lineText.startsWith('repeat')) {
            // Save the current tick for later use, but only if we started inside a repeat block
            if (!startedOutsideOfLoop)
                loopStartTick = tickCount;
            continue;
        }

        if (lineText.startsWith('+')) tickCount += +(lineText.substring(1, lineText.indexOf('>')));
        else {
            tickCount += +(lineText.substring(0, lineText.indexOf('>')));
            break;
        }
    }

    if (loopStartTick)
        loopStartTick = tickCount - loopStartTick;

    return [tickCount, loopStartTick];
}

// Params: document: the document in which to search, index: the index of the end line of the repeat block
// Returns: the number of ticks, the index of the line of the repeat statement that it ended on
function getTicksPassingLoop(document: vscode.TextDocument, index: number): [number, number] {
    var tickCountInLoop = 0;
    while (!document.lineAt(--index).text.trim().startsWith('repeat') && index >= 0) {
        const lineText = document.lineAt(index).text.trim();
        if (lineText.startsWith('start') || lineText.startsWith('//') || lineText.length === 0) continue;

        // Nested loop found. Using recursion to get the ticks passing in that loop
        if (lineText.startsWith('end')) {
            const [ticksPassing, indexOfRepeatStatement] = getTicksPassingLoop(document, index);
            index = indexOfRepeatStatement;
            tickCountInLoop += ticksPassing;
            continue;
        }

        tickCountInLoop += +(lineText.substring(1, lineText.indexOf('>')));
    }

    // Get the number of iterations of the repeat block
    const iterations = +document.lineAt(index).text.trim().substring(6);

    if (iterations !== 0)
        return [tickCountInLoop * iterations, index];
    // Zero iterations => This repeat block is never going to be executed
    else
        return [0, index];
}

function withMultilineComments(lineText: string, multilineCommentsOpen: number, line: number, reversed: Boolean = false): [string, number] {
    const multilineCommentOpenToken = lineText.indexOf('/*');
        const multilineCommentCloseToken = lineText.indexOf('*/');
        if (multilineCommentOpenToken !== -1 && multilineCommentCloseToken === -1) {
            // Add one if we're reversed, otherwise subtract one
            multilineCommentsOpen -= !reversed ? 1 : -1;
            if (!reversed && multilineCommentsOpen < 0) {
                // Commment was opened but never closed
                // FIXME: Show error line under the token. This can be done using a diagnostic collection, however,
                //  this should be checked for every time something is changed in the file, and not suddently appear when hovering.
                vscode.window.showErrorMessage(`Comment was opened but never closed! (line: ${++line}, column: ${multilineCommentOpenToken})`);
                return ["", 0];
            }

            lineText = lineText.substring(0, multilineCommentOpenToken);
        }
        if (lineText.indexOf('*/') !== -1) {
            if (multilineCommentOpenToken === -1) {
                // Subtract one if we're reversed, otherwise add one
                multilineCommentsOpen += !reversed ? 1 : -1;
                if (reversed && multilineCommentsOpen < 0) {
                    // Commment was opened but never closed. See FIXME above!
                    vscode.window.showErrorMessage(`Comment was opened but never closed! (line: ${++line}, column: ${multilineCommentCloseToken})`);
                    return ["", 0];
                }

                lineText = lineText.substring(multilineCommentCloseToken + 2);
            }
            else
                lineText = lineText.substring(multilineCommentOpenToken + 2, multilineCommentCloseToken);
        }

    return [lineText, multilineCommentsOpen];
}
