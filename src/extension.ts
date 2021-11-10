
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
                if (!hoveredLineText.startsWith('+')) {
                    return {
                        contents: [`Tick: ${hoveredLineText.substring(0, hoveredLineText.indexOf('>'))}`]
                    };
                }

                var tickCount = 0;
                for (var i = 0; i <= position.line; i++) {
                    const lineText = document.lineAt(i).text;
                    if (lineText.startsWith('start') || lineText.startsWith('//') || lineText.trim().length == 0) continue;

                    if (lineText.startsWith('+')) tickCount += +(lineText.substring(1, lineText.indexOf('>')));
                    else tickCount = +(lineText.substring(0, lineText.indexOf('>')));
                }

                return {
                    contents: [`Tick: ${tickCount}`]
                };
            }

            return {
                contents: []
            };
        }
    });

    context.subscriptions.push(hoverProvider);
}
