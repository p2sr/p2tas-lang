
import * as vscode from 'vscode';

const tokens: { [command: string]: string[]; } = {
    "start": ["now","save","map","next","cm"],
    "autojump": ["on","off"],
    "absmov": ["off"],
    "strafe": ["none","off","vec","ang","veccam","max","keep","forward","forwardvel","left","right"],
    "setang": [],
    "autoaim": ["off"],
    "decel": ["off"]
};

export function activate(context: vscode.ExtensionContext) {

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
            const hoveredLineText = document.lineAt(position.line).text;

            if (!hoveredLineText.startsWith('//') && position.character < hoveredLineText.indexOf('>')) {
                const [tick, loopStartTick] = getTickForLine(position.line, document);
                return {
                    contents: [`Tick: ${tick}${loopStartTick ? ` (Repeat start: ${loopStartTick})` : ""}`]
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
            // Find the next framebulk up the file (matches relative and absolute ticks)
            while (!editor!.document.lineAt(--previousFramebulk).text.match("^[\d|+]") && previousFramebulk > 0);

            if (previousFramebulk === 0) {
                // No previous framebulk found. Inserting it at the cursor position as the absolute tick
                if (editor!.selection.isEmpty) editBuilder.insert(cursorPos, `${input}>||||`);
                else editBuilder.replace(editor!.selection, `${input}>||||`);
                return;
            }

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
}

// Returns the tick count and the tick count of the start of a repeat block
// FIXME: This is dumb
function getTickForLine(line: number, document: vscode.TextDocument): [number, number | undefined] {
    const targetLine = document.lineAt(line).text;

    if (!targetLine.startsWith('+'))
        return [+targetLine.substring(0, targetLine.indexOf('>')), undefined];

    var tickCount = 0;
    for (var i = 0; i <= line; i++) {
        const lineText = document.lineAt(i).text;
        if (lineText.startsWith('start') || lineText.startsWith('//') || lineText.trim().length === 0) continue;

        if (lineText.startsWith('repeat')) {
            // Get the number after "repeat "
            const iterations = +(lineText.substring(6));

            // Evaluate the number of ticks passing in one loop iteration
            var tickCountInLoop = 0;
            while (document.lineAt(++i).text.trim() !== "end" && i <= line) {
                let lineText = document.lineAt(i).text
                tickCountInLoop += +(lineText.substring(1, lineText.indexOf('>')));
            }

            if (i >= line) return [tickCount + tickCountInLoop, tickCount];
            tickCount += iterations * tickCountInLoop;
            continue;
        }

        if (lineText.startsWith('+')) tickCount += +(lineText.substring(1, lineText.indexOf('>')));
        else tickCount = +(lineText.substring(0, lineText.indexOf('>')));
    }

    return [tickCount, undefined];
}
