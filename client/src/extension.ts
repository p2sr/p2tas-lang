import * as path from 'path';
import * as vscode from 'vscode';
import { TASServer } from './TASServer';
import { TASSidebarProvider } from './sidebar';

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
    Disposable
} from 'vscode-languageclient/node';

let client: LanguageClient;

export var server: TASServer;

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

const debugBulkDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("editor.wordHighlightBackground"),
});

const debugActiveToolDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("editor.wordHighlightStrongBackground"),
});

var onDidChangeTextEditorSelectionDisposable: Disposable;

let lastPlayedScriptDocument: vscode.TextDocument | null = null;
let scriptStateDirtyForDebug = true; // has the script been saved in a dirty state since it was played?

export function activate(context: vscode.ExtensionContext) {
    var configuration = vscode.workspace.getConfiguration('p2tas-lang');

    // Language client
    let serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));
    let debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    let serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: debugOptions
        }
    };

    // Options to control the language client
    let clientOptions: LanguageClientOptions = {
        // Register the server for p2tas scripts
        documentSelector: [{ scheme: 'file', language: 'p2tas' }],
        synchronize: {
            // Notify the server about file changes to '.clientrc files contained in the workspace
            fileEvents: vscode.workspace.createFileSystemWatcher('**/.clientrc')
        }
    };

    // Create the language client and start the client.
    client = new LanguageClient(
        'p2tasLanguageServer',
        'P2-TAS Language Server',
        serverOptions,
        clientOptions
    );

    client.registerProposedFeatures();

    if (configuration.get<boolean>("showActiveToolsDisplay")) {
        // Draw the active tools display when the client is ready to have it pop up
        client.onReady().then(() => drawActiveToolsDisplay(vscode.window.activeTextEditor!.selection.active, vscode.window.activeTextEditor!.document));
    }

    // Start the client. This will also launch the server
    client.start();

    server = new TASServer();
    server.setConfirmFieldChanges(configuration.get<boolean>("confirmFieldChangesInSidebar"));
    server.onRequestPlayback = (document: vscode.TextDocument) => {
        lastPlayedScriptDocument = document;
        scriptStateDirtyForDebug = false;
        updateDebugTickHighlight();
    };
    server.onDataUpdate = () => {
        updateDebugTickHighlight();
    };

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

        const cursorPos = editor!.selection.active;
        var previousFramebulk = cursorPos.line;

        const previousFramebulkTick: number = await client.sendRequest("p2tas/lineTick", [editor!.document.uri, previousFramebulk]);

        editor.edit(async editBuilder => {
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

    vscode.commands.registerCommand("p2tas-lang.toggleLineTickType", async () => {
        var editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage("No currently active editor");
            return;
        };

        const line = editor!.selection.active.line;
        const oldLineText = editor!.document.lineAt(line).text;

        const newLineText: string = await client.sendRequest("p2tas/toggleLineTickType", [editor!.document.uri, line]);
        if (newLineText === "" || newLineText === oldLineText) return;

        editor.edit(editBuilder => {
            editBuilder.replace(new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, oldLineText.length)), newLineText);
        });
    });

    const codeActionProvider = vscode.languages.registerCodeActionsProvider('p2tas', {
        async provideCodeActions(document, range): Promise<vscode.CodeAction[] | undefined> {
            const line = range.start.line;
            const oldLineText = document.lineAt(line).text;

            const newLineText: string = await client.sendRequest("p2tas/toggleLineTickType", [document.uri, line]);
            if (newLineText === "" || newLineText === oldLineText) return [];

            const toggleLineTickType = new vscode.CodeAction("Toggle line tick type", vscode.CodeActionKind.RefactorRewrite);
            toggleLineTickType.edit = new vscode.WorkspaceEdit();
            toggleLineTickType.edit.replace(document.uri, new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, oldLineText.length)), newLineText);
            toggleLineTickType.isPreferred = true;

            return [toggleLineTickType];
        }
    });

    context.subscriptions.push(codeActionProvider);

    if (configuration.get<boolean>("showActiveToolsDisplay")) {
        onDidChangeTextEditorSelectionDisposable = registerActiveToolsDisplay();
    }

    // --------------------------------------------------------------------------------------------------
    //                                             Sockets
    // --------------------------------------------------------------------------------------------------

    vscode.commands.registerCommand("p2tas-lang.connectSAR", () => server.connect());
    vscode.commands.registerCommand("p2tas-lang.disconnectSAR", () => server.disconnect());
    vscode.commands.registerCommand("p2tas-lang.playToolsTAS", () => server.requestToolsPlayback());
    vscode.commands.registerCommand("p2tas-lang.playRawTAS", () => server.requestRawPlayback());
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

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        configuration = vscode.workspace.getConfiguration('p2tas-lang');

        if (e.affectsConfiguration("p2tas-lang.showActiveToolsDisplay")) {
            if (configuration.get<boolean>("showActiveToolsDisplay")) {
                onDidChangeTextEditorSelectionDisposable = registerActiveToolsDisplay();
            }
            else {
                onDidChangeTextEditorSelectionDisposable?.dispose();
                onDidChangeTextEditorSelectionDisposable = undefined;
            }
        }

        if (e.affectsConfiguration("p2tas-lang.showDebugTick")) {
            updateDebugTickHighlight();
        }

        if (e.affectsConfiguration("p2tas-lang.confirmFieldChangesInSidebar")) {
            server.setConfirmFieldChanges(configuration.get<boolean>("confirmFieldChangesInSidebar"));
        }
    }));

    context.subscriptions.push(vscode.workspace.onWillSaveTextDocument(event => {
        if (event.document.isDirty && lastPlayedScriptDocument?.uri?.toString() === event.document.uri.toString()) {
            scriptStateDirtyForDebug = true;
            updateDebugTickHighlight();
        }
    }));

    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
        if (lastPlayedScriptDocument?.uri?.toString() === event.document.uri.toString()) {
            updateDebugTickHighlight();
        }
    }));

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(event => {
        // In the case that the text editor wasn't visible when a change to showDebugTick occurred, the decorations
        // won't yet have been modified, so we need to trigger an update to the highlight now
        if (lastPlayedScriptDocument?.uri?.toString() === event.document.uri.toString()) {
            updateDebugTickHighlight();
        }
    }));
}

function registerActiveToolsDisplay(): Disposable {
    return vscode.window.onDidChangeTextEditorSelection(event => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const cursorPos = event.selections[0].active;
        drawActiveToolsDisplay(cursorPos, editor.document);
    });
}

class ActiveTool {
    constructor(
        public tool: string,
        public fromLine: number,
        public startCol: number,
        public endCol: number,
        public ticksRemaining?: number,
    ) { }
}

function parseActiveTools(str: string): ActiveTool[] {
    if (str.length === 0) return [];

    let tools = new Array<ActiveTool>();

    for (const toolPart of str.split(",")) {
        const parts = toolPart.split("/");
        const toolName = parts[0];
        const toolLine = parseInt(parts[1], 10);
        const toolStart = parseInt(parts[2], 10);
        const toolEnd = parseInt(parts[3], 10);
        const toolTicks = parts.length > 4 ? parseInt(parts[4], 10) : null;
        tools.push(new ActiveTool(toolName, toolLine, toolStart, toolEnd, toolTicks));
    }

    return tools;
}

async function drawActiveToolsDisplay(cursorPos: vscode.Position, document: vscode.TextDocument) {
    const toolsStr: string = await client.sendRequest("p2tas/activeTools", [document.uri, cursorPos.line]);
    const tools = parseActiveTools(toolsStr);

    const toolsText = tools.map(tool => {
        if (tool.ticksRemaining) return `${tool.tool} (${tool.ticksRemaining} ticks remaining)`;
        else return tool.tool;
    }).join(", ");

    activeToolsDisplayDecoration = {
        range: new vscode.Range(cursorPos, document.lineAt(cursorPos.line).range.end),
        renderOptions: {
            after: {
                contentText: tools.length > 0 ? `Active tools: ${toolsText}` : "",
                textDecoration: ";font-size:11px",
                fontWeight: ";font-weight:lighter"
            }
        }
    };
    vscode.window.activeTextEditor!.setDecorations(activeToolsDisplayDecorationType, [activeToolsDisplayDecoration]);
}

async function updateDebugTickHighlight() {
    const enabled = vscode.workspace.getConfiguration('p2tas-lang').get<boolean>("showDebugTick");
    const document = lastPlayedScriptDocument;
    const curTick = server.debugTick;

    if (!enabled ||
        document === null ||
        scriptStateDirtyForDebug ||
        document.isDirty ||
        !server.connected ||
        curTick < 0 ||
        !vscode.window.activeTextEditor ||
        document.uri?.toString() != vscode.window.activeTextEditor!.document.uri.toString()
    ) {
        // remove active decorations
        for (const editor of vscode.window.visibleTextEditors) {
            editor.setDecorations(debugBulkDecorationType, []);
            editor.setDecorations(debugActiveToolDecorationType, []);
        }
        return;
    }

    const line: number = await client.sendRequest("p2tas/tickLine", [document.uri, curTick]);
    const lineTick: number = await client.sendRequest("p2tas/lineTick", [document.uri, line]);

    const toolsStr: string = await client.sendRequest("p2tas/activeTools", [document.uri, line]);
    const tools = parseActiveTools(toolsStr).filter(tool => tool.ticksRemaining === null || tool.ticksRemaining + lineTick > curTick);

    const debugBulkDecoration = {
        range: document.lineAt(line).range,
    };
    vscode.window.activeTextEditor!.setDecorations(debugBulkDecorationType, [debugBulkDecoration]);

    const debugActiveToolDecorations = tools.map(tool => ({
        range: new vscode.Range(tool.fromLine, tool.startCol, tool.fromLine, tool.endCol),
    }));
    vscode.window.activeTextEditor!.setDecorations(debugActiveToolDecorationType, debugActiveToolDecorations);
}
