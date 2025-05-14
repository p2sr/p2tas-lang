import * as vscode from 'vscode';
import { TASServer, TASStatus } from './TASServer';

export class TASSidebarProvider implements vscode.WebviewViewProvider {
    _view?: vscode.WebviewView;
    server: TASServer;

    constructor(private readonly _extensionUri: vscode.Uri, server_: TASServer) {
        this.server = server_;
        this.server.webView = this;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, "css"),
                vscode.Uri.joinPath(this._extensionUri, "client", "src"),
                vscode.Uri.joinPath(this._extensionUri, "images")
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'connect':
                    this.server.connect();
                    break;
                case 'playToolsTAS':
                    this.server.requestToolsPlayback();
                    break;
                case 'playRawTAS':
                    this.server.requestRawPlayback();
                    break;
                case 'stopTAS':
                    this.server.requestStopPlayback();
                    break;
                case 'changeRate':
                    this.server.requestRatePlayback(data.rate);
                    break;
                case 'resumeTAS':
                    this.server.requestStatePlaying();
                    break;
                case 'pauseTAS':
                    this.server.requestStatePaused();
                    break;
                case 'fastForward':
                    this.server.requestFastForward(data.tick, data.pauseAfter);
                    break;
                case 'nextPause':
                    this.server.requestNextPauseTick(data.tick);
                    break;
                case 'tickAdvance':
                    this.server.requestTickAdvance();
                    break;
                case 'disconnect':
                    this.server.disconnect();
                    break;
            }
        });

        this._view?.webview.postMessage({ reset: 1 });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const styleResetUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "css", "reset.css")
        );

        const styleVSCodeUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "css", "vscode.css")
        );

        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "client", "src", "sidebarScript.js")
        );

        const connectUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "images", "connect.svg")
        );

        const playUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "images", "play.svg")
        );

        const pauseUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "images", "pause.svg")
        );

        const stopUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "images", "stop.svg")
        );

        const replayUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "images", "replay.svg")
        );

        const nextTickUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "images", "next-tick.svg")
        );

        const applyUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "images", "apply.svg")
        );

        const linkUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "images", "link.svg")
        );

        // Use a nonce to only allow a specific script to be run.
        const nonce = getNonce();

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <!--
                Use a content security policy to only allow loading images from https or from our extension directory,
                and only allow scripts that have a specific nonce.
            -->
            <meta http-equiv="Content-Security-Policy" content="img-src https: data:; style-src 'unsafe-inline' 
                ${webview.cspSource}; script-src 'nonce-${nonce}';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${styleResetUri}" rel="stylesheet">
            <link href="${styleVSCodeUri}" rel="stylesheet">
            <title>P2-TAS</title>
        </head>
        <body>
            <div id="connection">
                <div id="server-data">
                    <p>Status: <span id="data-status">Inactive</span></p>
                    <p>Current tick: <span id="data-tick">0</span></p>
                </div>
                <img id="connect-button" class="heavy-button disconnected" src="${connectUri}" alt="Connect">
            </div>

            <div id="buttons">
                <div id="play-buttons">
                    <img id="stop-button" src="${stopUri}" alt="Stop">
                    <img id="raw-button" src="${playUri}" alt="Play raw">
                    <!-- data-src-play and data-src-pause are used in the script to change the src of the image to the appropriate uri -->
                    <img id="start-button" class="heavy-button" src="${playUri}" alt="Play" data-src-play="${playUri}" data-src-pause="${pauseUri}">
                    <img id="replay-button" src="${replayUri}" alt="Replay">
                    <img id="tick-advance-button" src="${nextTickUri}" alt="Advance tick">
                </div>

                <div>
                    <label for="rate-input-slider">Playback rate</label>
                    <div class="input">
                        <div id="rate">
                            <input type="range" id="rate-input-slider" list="tickmarks" min="0" max="1" value="1" step="0.025">
                            <datalist id="tickmarks">
                                <option value = "0" label="0">
                                <option value = "0.25" label="0.25">
                                <option value = "0.5" label="0.5">
                                <option value = "0.75" label="0.75">
                                <option value = "1" label="1">
                            </datalist>
    
                            <!-- This has an empty label to avoid accessibility issues in certain contexts -->
                            <label for="rate-input-text"></label>
                            <input type="text" id="rate-input-text" placeholder="1">
                        </div>
                        <img id="rate-button" class="unchanged checkmark" tabindex="-1" src="${applyUri}" alt="Apply">
                    </div>
                </div>

                <div id="tick-control">
                    <label for="skip-input">Skip to</label>
                    <div class="input">
                        <input type="text" id="skip-input" placeholder="0">
                        <img id="skip-button" class="unchanged checkmark" tabindex="-1" src="${applyUri}" alt="Apply">
                    </div>

                    <div id="link">
                        <img src="${linkUri}" alt="Link">
                        <div id="link-disabled" class="invisible"></div>
                    </div>

                    <label for="pauseat-input">Pause at</label>
                    <div class="input">
                        <input type="text" id="pauseat-input" placeholder="0" disabled>
                        <img id="pauseat-button" class="unchanged checkmark" tabindex="-1" src="${applyUri}" alt="Apply">
                    </div>
                </div>
            </div>

            <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
        </html>
        `;
    }

    public updateWebView() {
        const message = {
            connected: this.server.connected,
            state: TASStatus[this.server.status],
            rate: this.server.playbackRate,
            currentTick: this.server.currentTick,
            confirmFieldChanges: this.server.userConfirmFieldChanges,
        };
        this._view?.webview.postMessage(message);
    }
}

export function getNonce() {
    let text = "";
    const possible =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
