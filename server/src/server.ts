import { TextDocument } from 'vscode-languageserver-textdocument';
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
	TextDocuments,
} from 'vscode-languageserver/node';
import { endCompletion, repeatCompletion, startCompletion, startTypes, versionCompletion } from './tas-script/otherCompletion';
import { LineType, ScriptLine, TASScript } from './tas-script/tasScript';
import { TASTool } from './tas-script/tasTool';
import { Token, TokenType } from './tas-script/tokenizer';

const connection = createConnection(ProposedFeatures.all);
const rawDocuments = new TextDocuments(TextDocument);
const documents: Map<string, TASScript> = new Map();

var hasConfigurationCapability = false;

connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;

	hasConfigurationCapability = !!(capabilities.workspace && !!capabilities.workspace.configuration);

	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
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

/**
 * Gets settings from client configuration.
 * In VSCode, these can be found in the Settings tab (or the configuration JSON file).
 */
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

rawDocuments.onDidOpen((params) => {
	const tasScript = new TASScript();

	const diagnostics = tasScript.parse(params.document.getText());
	if (settings.doErrorChecking) connection.sendDiagnostics({ uri: params.document.uri, diagnostics });

	documents.set(params.document.uri, tasScript);
});

rawDocuments.onDidChangeContent((params) => {
	// parse the script again to collect diagnostics and general script information
	// could to incremental parsing here, probably overkill for our usecase though
	const diagnostics = documents.get(params.document.uri)?.parse(params.document.getText());
	if (diagnostics && settings.doErrorChecking) connection.sendDiagnostics({ uri: params.document.uri, diagnostics });
});

rawDocuments.onDidClose((params) => { documents.delete(params.document.uri); });

// FIXME: We currently also suggest tool arguments when in a multiline comment. We should check whether
//        the cursor is in a multiline comment and don't suggest anything.
connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
	const script = documents.get(params.textDocument.uri);
	if (script === undefined) return [];
	const line = script.lines.get(params.position.line);

	// the line of the cursor is not present in our script (happens e.g. when the user inserts empty lines below the last framebulk)
	// => suggest start, version, repeat, end
	// FIXME: Don't suggest version/start if they are already present in the script.
	if (line === undefined) {
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
	// suggest tools and arguments for framebulks with 4 pipes, when the cursor is positioned after the last pipe
	else if (line.type === LineType.Framebulk) {
		if (line.tokens.filter(tok => tok.type === TokenType.Pipe).length !== 4)
			return [];

		const pipeIndex = line.lineText.lastIndexOf('|');
		if (params.position.character < pipeIndex) return [];

		return completeToolAndArguments(line, params.position.character);
	}
	// suggest tools and arguments to tool bulks when after the last '>'
	else if (line.type === LineType.ToolBulk) {
		const angleIndex = line.lineText.lastIndexOf('>');
		if (params.position.character < angleIndex) return [];

		return completeToolAndArguments(line, params.position.character);
	}
	// suggest "start" line parameters
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

/** Resolve `CompletionItems` for the tool focused by the cursor in line `line` and column `character`. */
function completeToolAndArguments(line: ScriptLine, character: number): CompletionItem[] {
	const [toolName, encounteredWords] = getToolAndArguments(character, line.tokens);

	// if no tool was found (e.g. the cursor is right behind a '|'), suggest tools
	if (toolName.length === 0) {
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
	// since a tool was found, suggest its arguments
	else {
		if (!TASTool.tools.hasOwnProperty(toolName)) return [];
		if (encounteredWords.includes("off")) return [];

		const tool = TASTool.tools[toolName];
		const result: CompletionItem[] = [];
		// add "off" argument suggestion if the tool supports it and no other arguments have been given
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

		// suggest arguments that haven't been given yet
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

/**
 * From the given character index, go back through the line's tokens to find the corresponding tool and its
 * arguments up to this point.
 */
// TODO: It might be better to have the parser extract this information from the script instead of searching
//       through the tokens here.
function getToolAndArguments(character: number, tokens: Token[]): [string, string[]] {
	// the words we found while going through the line backwards to search for the tool name
	var encounteredWords: string[] = [];
	var tool = "";

	var index = tokens.length;
	outer: {
		while (--index >= 0) {
			const token = tokens[index];
			// skip tokens after the given character position
			if (character < token.end) continue;
			// A section (tool section of a framebulk/tool bulk, tool invocation) has ended. Since we're only
			// interested in the tool and arguments the cursor is "in", stop here.
			// This is needed when the cursor is right behind a '|' for example.
			if (token.type === TokenType.Pipe || token.type === TokenType.Semicolon || token.type === TokenType.DoubleRightAngle) break outer;
			// reached the start of the line
			if (index - 1 < 0) {
				tool = token.text;
				break;
			}

			switch (tokens[index - 1].type) {
				case TokenType.String:
					encounteredWords.push(token.text);
					break;
				// we have reached the end of a section
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
		// find hovered token
		for (var i = 0; i < line.tokens.length; i++) {
			const token = line.tokens[i];
			if (params.position.character < token.start || params.position.character > token.end) continue;

			// if we are hovering the tick number at the start of the framebulk, show the absolute tick
			if (token.type === TokenType.Number) {
				if (i + 1 >= line.tokens.length || (line.tokens[i + 1].type !== TokenType.RightAngle && line.tokens[i + 1].type !== TokenType.DoubleRightAngle)) continue;
				return { contents: [`Tick: ${line.tick}`] };
			}

			if (token.type !== TokenType.String) continue;

			// show information tools or tool arguments
			// TODO: This currently doesn't check which tool the hovered argument belongs to. By doing something
			//       similar to completeToolAndArguments to find out the tool in question, this could be improved.
			//       In addition, that might allow us to show information on "off" arguments for example.
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
	else if (line.type === LineType.RepeatStart) {
		// show information on the "repeat" keyword when hovering it
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
		// find hovered token and show information on the "start" keyword or its arguments
		for (const token of line.tokens) {
			if (params.position.character < token.start || params.position.character > token.end) continue;

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

		return undefined;
	}
	else if (line.type === LineType.End) {
		// show information on the "end" keyword when hovering it
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
		// show information on the "version" keyword when hovering it
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

/**
 * Returns the active tools on request of the client.
 * Format: <tool name>/<from line>/<start column>/<end column>[/<ticks remaining if possible>]
 */
connection.onRequest("p2tas/activeTools", (params: [any, number]) => {
	const [uri, lineNumber] = params;

	const script = documents.get(uri.external);
	if (script === undefined) return "";
	const line = script.lines.get(lineNumber);
	if (line === undefined) return "";

	return line.activeTools.map(tool =>
		`${tool.tool}/${tool.fromLine}/${tool.startCol}/${tool.endCol}` + (tool.ticksRemaining ? `/${tool.ticksRemaining}` : "")
	).join(",");
});

/** Returns the absolute tick of the given line on request of the client. */
connection.onRequest("p2tas/lineTick", (params: [any, number]) => {
	const [uri, lineNumber] = params;

	const script = documents.get(uri.external);
	if (script === undefined) return "";

	return script.lines.get(lineNumber)?.tick || "";
});

/** Returns the line at the line with the given tick, or the one before on request of the client. */
connection.onRequest("p2tas/tickLine", (params: [any, number]) => {
	const [uri, tick] = params;

	const script = documents.get(uri.external);
	if (script === undefined) return "";

	let lastLine: number = -1;
	script.lines.forEach((line, num) => {
		if (num <= lastLine) return;
		if (line.type !== LineType.Framebulk && line.type !== LineType.ToolBulk) return;
		if (line.tick > tick) return;
		lastLine = num;
	})

	return lastLine == -1 ? "" : lastLine;
});

/** Toggles the given line's tick type (absolute <=> relative) on request of the client. */
connection.onRequest("p2tas/toggleLineTickType", (params: [any, number]) => {
	const [uri, lineNumber] = params;

	const script = documents.get(uri.external);
	if (script === undefined) return "";
	const line = script.lines.get(lineNumber);
	if (line === undefined) return "";

	if (line.type !== LineType.Framebulk && line.type != LineType.ToolBulk) return line.lineText;

	if (!line.isRelative) {
		// Switch from absolute to relative
		let previousLine: ScriptLine | undefined = undefined;
		let prevLineNumber = lineNumber;

		// Find the previous line
		while (previousLine === undefined) {
			prevLineNumber--;

			if (prevLineNumber < 0) return line.lineText;

			previousLine = script.lines.get(prevLineNumber)
		}

		// If there is no previous line, then the requested line was the first line in the file
		if ((previousLine!.type === LineType.Start || previousLine!.type === LineType.Version)) return line.lineText;

		// Invalid line format
		if (line.tokens[0].type !== TokenType.Number) return line.lineText;

		// Reformat the line to use the new tick format
		const newTickSection = `+${line.tick - previousLine.tick}`;
		//     everything before the number                      -|relative tick  -|everything after the tick
		return `${line.lineText.substring(0, line.tokens[0].start)}${newTickSection}${line.lineText.substring(line.tokens[0].end).replace(/\r|\n/, "")}`;
	}
	else {
		// Switch from relative to absolute
		// Invalid line format
		if (line.tokens[0].type !== TokenType.Plus || line.tokens[1].type !== TokenType.Number) return line.lineText;

		// We already have the absolute tick of every line parsed out, so we just need to reformat the line to use it
		const newTickSection = `${line.tick}`;
		//      everything before the plus                       -|everything after the plus                                         -|absolute tick  -|everything after the tick                    (remove new line)
		return `${line.lineText.substring(0, line.tokens[0].start)}${line.lineText.substring(line.tokens[0].end, line.tokens[1].start)}${newTickSection}${line.lineText.substring(line.tokens[1].end).replace(/\r|\n/, "")}`;
	}
});

// Make the text document manager listen on the connection for events
rawDocuments.listen(connection);

// Listen on the connection
connection.listen();
