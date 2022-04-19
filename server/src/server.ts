import {
	createConnection,
	ProposedFeatures,
	InitializeParams,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InsertTextFormat,
	MarkupKind
} from 'vscode-languageserver/node';
import { endCompletion, repeatCompletion, startCompletion, startTypes } from './tas-script/otherCompletion';
import { LineType, ScriptLine, TASScript } from './tas-script/tasScript';
import { TASTool } from './tas-script/tasTool';
import { TokenType } from './tas-script/tokenizer';
// import { TASTool } from './_tas-script/tasTool';
// import { CompletionItemDeclaration, endCompletion, startCompletion, startTypes } from './_tas-script/util';

const connection = createConnection(ProposedFeatures.all);
const documents: Map<string, TASScript> = new Map();

connection.onInitialize((params: InitializeParams) => {
	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Full,
			hoverProvider: true,
			completionProvider: {
				triggerCharacters: [" ", ";"]
			}
		}
	};
});

connection.onDidOpenTextDocument((params) => {
	const tasScript = new TASScript();

	const diagnostics = tasScript.parse(params.textDocument.text);
	connection.sendDiagnostics({ uri: params.textDocument.uri, diagnostics });

	documents.set(params.textDocument.uri, tasScript);
});

connection.onDidChangeTextDocument((params) => {
	params.contentChanges.forEach((change) => {
		const diagnostics = documents.get(params.textDocument.uri)?.parse(change.text);
		if (diagnostics)
			connection.sendDiagnostics({ uri: params.textDocument.uri, diagnostics });
	});
});

connection.onDidCloseTextDocument((params) => { documents.delete(params.textDocument.uri); });

connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
	const script = documents.get(params.textDocument.uri);
	if (script === undefined) return [];
	const line = script.lines.get(params.position.line);
	if (line === undefined) return [];

	if (line.type === LineType.Framebulk) {
		if (line.lineText.split('|').length - 1 !== 4) {
			if (line.tokens.length === 0) {
				return [startCompletion, repeatCompletion, endCompletion].map((item) => {
					return {
						label: item.name,
						kind: CompletionItemKind.Method,
						documentation: {
							kind: MarkupKind.Markdown,
							value: item.description
						}
					};
				});
			}

			return [];
		}

		const pipeIndex = line.lineText.lastIndexOf('|');
		if (params.position.character < pipeIndex) return [];

		const [toolName, encounteredWords] = getToolAndArguments(params.position.character, line.lineText, pipeIndex);

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
	else if (line.type === LineType.Start) {
		const [toolName, encounteredWords] = getToolAndArguments(params.position.character, line.lineText);
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

function getToolAndArguments(character: number, lineText: string, lowestCharacterIndex: number = 0): [string, string[]] {
	var encounteredWords: string[] = [];
	var tool = "";
	var index = character;
	while (index >= lowestCharacterIndex) {
		const char = lineText.charAt(index);
		if (char === ' ') {
			if (tool.length > 0) {
				encounteredWords.push(tool);
				tool = "";
			}
		}
		else if (char === '|' || char === ';')
			break;
		else if (char !== '\r' && char !== '\n')
			tool = char + tool;

		index--;
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

	for (var i = 0; i < line.tokens.length; i++) {
		const token = line.tokens[i];
		if (params.position.character >= token.start && params.position.character <= token.end) {
			if (token.type === TokenType.Number) {
				if (line.tokens[i + 1].type !== TokenType.RightAngle) continue;
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

	return undefined;
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

	if (line.type !== LineType.Framebulk) return "";

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