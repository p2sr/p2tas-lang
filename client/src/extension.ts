import * as path from 'path';
import * as vscode from 'vscode';
import { TASServer } from './TASServer';
import { TASSidebarProvider } from './sidebar';

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
    RequestType
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

export function activate(context: vscode.ExtensionContext) {
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

    // Draw the active tools display when the client is ready to have it pop up
    client.onReady().then(() => drawActiveToolsDisplay(vscode.window.activeTextEditor!.selection.active, vscode.window.activeTextEditor!.document));

    // Start the client. This will also launch the server
    client.start();

    server = new TASServer();

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

    vscode.window.onDidChangeTextEditorSelection(event => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const cursorPos = event.selections[0].active;
        drawActiveToolsDisplay(cursorPos, editor.document);
    });

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

async function drawActiveToolsDisplay(cursorPos: vscode.Position, document: vscode.TextDocument) {
    const tools: string = await client.sendRequest("p2tas/activeTools", [document.uri, cursorPos.line]);
    if (tools.length == 0) return;

    activeToolsDisplayDecoration = {
        range: new vscode.Range(cursorPos, document.lineAt(cursorPos.line).range.end),
        renderOptions: {
            after: {
                contentText: `Active tools: ${tools}`,
                textDecoration: ";font-size:11px",
                fontWeight: ";font-weight:lighter"
            }
        }
    };
    vscode.window.activeTextEditor!.setDecorations(activeToolsDisplayDecorationType, [activeToolsDisplayDecoration]);
}
