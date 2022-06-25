import {
	createConnection,
	ProposedFeatures,
	InitializeParams,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	MarkupKind,
	DidChangeConfigurationNotification,
} from 'vscode-languageserver/node';
import { endCompletion, repeatCompletion, startCompletion, startTypes, versionCompletion } from './tas-script/otherCompletion';
import { LineType, ScriptLine, TASScript } from './tas-script/tasScript';
import { TASTool } from './tas-script/tasTool';
import { Token, TokenType } from './tas-script/tokenizer';

const connection = createConnection(ProposedFeatures.all);
const documents: Map<string, TASScript> = new Map();

var hasConfigurationCapability = false;

connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;

	hasConfigurationCapability = !!(capabilities.workspace && !!capabilities.workspace.configuration);

	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Full,
			hoverProvider: true,
			completionProvider: {
				triggerCharacters: [" ", ";", "|", ">"]
			}
		}
	};
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}

	pullSettings();
});

interface Settings {
	doErrorChecking: boolean,
}

const defaultSettings: Settings = { doErrorChecking: true };
var settings: Settings = defaultSettings;

connection.onDidChangeConfiguration(_ => pullSettings());

async function pullSettings() {
	const configuration = await connection.workspace.getConfiguration({ section: "p2tasLanguageServer" });

	settings = configuration as Settings;
	if (!settings.doErrorChecking) {
		// Remove all diagnostics
		documents.forEach((doc, uri) => connection.sendDiagnostics({ uri, diagnostics: [] }));
	}
	else {
		documents.forEach((doc, uri) => {
			const diagnostics = doc.parse();
			if (diagnostics)
				connection.sendDiagnostics({ uri, diagnostics });
		});
	}
}

connection.onDidOpenTextDocument((params) => {
	const tasScript = new TASScript();

	const diagnostics = tasScript.parse(params.textDocument.text);
	if (settings.doErrorChecking) connection.sendDiagnostics({ uri: params.textDocument.uri, diagnostics });

	documents.set(params.textDocument.uri, tasScript);
});

connection.onDidChangeTextDocument((params) => {
	params.contentChanges.forEach((change) => {
		const diagnostics = documents.get(params.textDocument.uri)?.parse(change.text);
		if (diagnostics && settings.doErrorChecking)
			connection.sendDiagnostics({ uri: params.textDocument.uri, diagnostics });
	});
});

connection.onDidCloseTextDocument((params) => { documents.delete(params.textDocument.uri); });

// FIXME: This needs to check if we are in a comment / skip comments on the way of finding the tool.
//        One idea might be to break when we find a comment open token in "getToolAndArguments", 
//        and advance to after the comment if we find a "*/".
connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
	const script = documents.get(params.textDocument.uri);
	if (script === undefined) return [];
	const line = script.lines.get(params.position.line);

	if (line === undefined || line.type === LineType.Empty) {
		return [versionCompletion, startCompletion, repeatCompletion, endCompletion].map((val) => {
			return {
				label: val.name,
				kind: CompletionItemKind.Method,
				documentation: {
					kind: MarkupKind.Markdown,
					value: val.description,
				}
			};
		});
	}
	else if (line.type === LineType.Framebulk) {
		// If we don't have 4 pipes, dont suggest
		if (line.tokens.filter(tok => tok.type === TokenType.Pipe).length !== 4)
			return [];

		const pipeIndex = line.lineText.lastIndexOf('|');
		if (params.position.character < pipeIndex) return [];

		return completeToolAndArguments(line, params.position.character);
	}
	else if (line.type === LineType.ToolBulk) {
		const angleIndex = line.lineText.lastIndexOf('>');
		if (params.position.character < angleIndex) return [];

		return completeToolAndArguments(line, params.position.character);
	}
	else if (line.type === LineType.Start) {
		const [toolName, encounteredWords] = getToolAndArguments(params.position.character, line.tokens);
		if (toolName !== "start") return [];

		return Object.entries(startTypes)
			.filter(([key, value]) => {
				if (encounteredWords.length >= 2) return false;
				if (encounteredWords.length === 1) {
					if (encounteredWords[0] === "next")
						return key !== "next";
					return false;
				}
				return true;
			}).map(([key, value]) => {
				return {
					label: key,
					kind: CompletionItemKind.Field,
					documentation: {
						kind: MarkupKind.Markdown,
						value: value.description
					}
				};
			});
	}

	return [];
});

function completeToolAndArguments(line: ScriptLine, character: number): CompletionItem[] {
	const [toolName, encounteredWords] = getToolAndArguments(character, line.tokens);

	if (toolName.length === 0) {
		// Complete tool
		return Object.entries(TASTool.tools).map(([key, value]) => {
			return {
				label: key,
				kind: CompletionItemKind.Method,
				documentation: {
					kind: MarkupKind.Markdown,
					value: value.description
				}
			};
		});
	}
	else {
		// Complete tool arguments
		// Check if tool exists
		if (!TASTool.tools.hasOwnProperty(toolName)) return [];
		if (encounteredWords.includes("off")) return [];

		const tool = TASTool.tools[toolName];
		const result: CompletionItem[] = [];
		if (encounteredWords.length === 0 && tool.hasOff) {
			result.push({
				label: "off",
				kind: CompletionItemKind.Field,
				documentation: {
					kind: MarkupKind.Markdown,
					value: `Disables ${"```"}${toolName}${"```"}`
				}
			});
		}

		const toolArguments = tool.arguments;
		result.push(...toolArguments
			.filter((arg) => {
				if (arg.type !== TokenType.String) return false;
				return !encounteredWords.includes(arg.text!);
			}).map((arg) => {
				return {
					label: arg.text!,
					kind: CompletionItemKind.Field,
					documentation: arg.description !== undefined ? {
						kind: MarkupKind.Markdown,
						value: arg.description!
					} : undefined
				};
			}));
		return result;
	}
}

function getToolAndArguments(character: number, tokens: Token[]): [string, string[]] {
	var encounteredWords: string[] = [];
	var tool = "";

	var index = tokens.length;
	outer: {
		while (--index >= 0) {
			const token = tokens[index];
			if (character < token.end) continue;
			if (token.type === TokenType.Pipe || token.type === TokenType.Semicolon || token.type === TokenType.DoubleRightAngle) break outer;
			if (index - 1 < 0) {
				tool = token.text;
				break;
			}

			switch (tokens[index - 1].type) {
				case TokenType.String:
					encounteredWords.push(token.text);
					break;
				case TokenType.Semicolon:
				case TokenType.Pipe:
				case TokenType.DoubleRightAngle:
					tool = token.text;
					break outer;
			}
		}
	}

	return [tool, encounteredWords];
}

// FIXME: This currently works anywhere in the line, as long as you have the word (e.g. "strafe"). 
//        However, I don't think this is a big problem so I don't care :)
connection.onHover((params, cancellationToken, workDoneProgressReporter, resultProgressReporter) => {
	const script = documents.get(params.textDocument.uri);
	if (!script) return undefined;

	const line = script.lines.get(params.position.line);
	if (line === undefined) return undefined;

	if (line.type === LineType.Framebulk || line.type === LineType.ToolBulk) {
		for (var i = 0; i < line.tokens.length; i++) {
			const token = line.tokens[i];
			if (params.position.character >= token.start && params.position.character <= token.end) {
				if (token.type === TokenType.Number) {
					if (i + 1 >= line.tokens.length || (line.tokens[i + 1].type !== TokenType.RightAngle && line.tokens[i + 1].type !== TokenType.DoubleRightAngle)) continue;
					return { contents: [`Tick: ${line.tick}`] };
				}
				else if (token.type !== TokenType.String) continue;

				const hoveredWord = token.text;
				for (const tool of Object.keys(TASTool.tools)) {
					if (tool === hoveredWord) {
						return {
							contents: {
								kind: MarkupKind.Markdown,
								value: TASTool.tools[tool].description
							}
						};
					}

					for (const argument of TASTool.tools[tool].arguments) {
						if (argument.type !== TokenType.String) continue;
						if (argument.text === hoveredWord) {
							if (argument.description === undefined) break;
							return {
								contents: {
									kind: MarkupKind.Markdown,
									value: argument.description,
								}
							};
						}
					}
				}
			}
		}
	}
	else if (line.type === LineType.RepeatStart) {
		if (line.tokens.length > 0 && line.tokens[0].type === TokenType.String && line.tokens[0].text === "repeat" &&
			params.position.character >= line.tokens[0].start && params.position.character <= line.tokens[0].end) {
			return {
				contents: {
					kind: MarkupKind.Markdown,
					value: repeatCompletion.description
				}
			};
		}
	}
	else if (line.type === LineType.Start) {
		for (const token of line.tokens) {
			if (params.position.character >= token.start && params.position.character <= token.end) {
				if (token.text === "start")
					return {
						contents: {
							kind: MarkupKind.Markdown,
							value: startCompletion.description
						}
					};

				if (startTypes.hasOwnProperty(token.text))
					return {
						contents: {
							kind: MarkupKind.Markdown,
							value: startTypes[token.text].description
						}
					};
			}
		}

		return undefined;
	}
	else if (line.type === LineType.End) {
		if (line.tokens.length > 0 && line.tokens[0].type === TokenType.String && line.tokens[0].text === "end" &&
			params.position.character >= line.tokens[0].start && params.position.character <= line.tokens[0].end) {
			return {
				contents: {
					kind: MarkupKind.Markdown,
					value: endCompletion.description
				}
			};
		}
	}
	else if (line.type === LineType.Version) {
		if (line.tokens.length > 0 && line.tokens[0].type === TokenType.String && line.tokens[0].text === "version" &&
			params.position.character >= line.tokens[0].start && params.position.character <= line.tokens[0].end) {
			return {
				contents: {
					kind: MarkupKind.Markdown,
					value: versionCompletion.description
				}
			};
		}
	}
});

connection.onRequest("p2tas/activeTools", (params: [any, number]) => {
	const [uri, lineNumber] = params;

	const script = documents.get(uri.external);
	if (script === undefined) return "";
	const line = script.lines.get(lineNumber);
	if (line === undefined) return "";

	return line.activeTools.map((tool) => `${tool.tool}${tool.ticksRemaining ? ` (${tool.ticksRemaining} ticks remaining)` : ""}`).join(", ");
});

connection.onRequest("p2tas/lineTick", (params: [any, number]) => {
	const [uri, lineNumber] = params;

	const script = documents.get(uri.external);
	if (script === undefined) return "";

	return script.lines.get(lineNumber)?.tick || "";
});

connection.onRequest("p2tas/toggleLineTickType", (params: [any, number]) => {
	const [uri, lineNumber] = params;

	const script = documents.get(uri.external);
	if (script === undefined) return "";
	const line = script.lines.get(lineNumber);
	if (line === undefined) return "";

	if (line.type !== LineType.Framebulk && line.type != LineType.ToolBulk) return line.lineText;

	if (!line.isRelative) {
		// Switch from absolute to relative
		let previousLine: ScriptLine | undefined = script.lines.get(lineNumber - 1);

		// If there is no previous line, then the requested line was the first line in the file
		if (previousLine === undefined || (previousLine!.type === LineType.Start || previousLine!.type === LineType.Version)) return line.lineText;

		// Invalid line format
		if (line.tokens[0].type !== TokenType.Number) return line.lineText;

		const newTickSection = `+${line.tick - previousLine.tick}`;
		//     everything before the number                      -|relative tick  -|everything after the tick
		return `${line.lineText.substring(0, line.tokens[0].start)}${newTickSection}${line.lineText.substring(line.tokens[0].end).replace(/\r|\n/, "")}`;
	}
	else {
		// Switch from relative to absolute
		// Invalid line format
		if (line.tokens[0].type !== TokenType.Plus || line.tokens[1].type !== TokenType.Number) return line.lineText;

		const newTickSection = `${line.tick}`;
		//      everything before the plus                       -|everything after the plus                                         -|absolute tick  -|everything after the tick                    (remove new line)
		return `${line.lineText.substring(0, line.tokens[0].start)}${line.lineText.substring(line.tokens[0].end, line.tokens[1].start)}${newTickSection}${line.lineText.substring(line.tokens[1].end).replace(/\r|\n/, "")}`;
	}
});

// Listen on the connection
connection.listen();