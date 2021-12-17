import * as vscode from 'vscode';
import { TASServer, TASStatus } from './TASServer';

export class TASSidebarProvider implements vscode.WebviewViewProvider {
    _view?: vscode.WebviewView;
    server: TASServer;
    last_message = {
        connected: false,
        state: "Inactive",
        rate: 1.0,
        currentTick: 0
    };

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
                vscode.Uri.joinPath(this._extensionUri, "src")
            ]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(data => {
			switch (data.type) {
                case 'connect':
                    this.server.connect();
                    break;
				case 'playTAS':
					this.server.requestPlayback();
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
                    this.server.requestFastForward(data.tick, true);
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
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const styleVSCodeUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "css", "vscode.css")
        );

        const styleResetUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "css", "reset.css")
        );

        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "src", "sidebarScript.js")
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
        </head>
        <body>
            <div>
                <h2 style="display:inline-block;color:red" id="status">Disconnected</h2>
                <button id="connect-button">Connect</button>
            </div>
            <div id="server-data" style="display:none">
                <h2>Server data</h2>
                <p>Playback: <span id="data-status">Inactive</span></p>
                <p>Playback rate: <span id="data-rate">1.0</span></p>
                <p>Current tick: <span id="data-tick">0</span></p>
            </div>
            <div id="buttons" style="display:none">
                <button id="start-stop-button">Play TAS</button>
                <button id="pause-resume-button">Pause TAS</button>
                <button id="tick-advance-button">Tick advance TAS</button>

                <button id="pauseat-button">Pause at tick</button>
                <input type="text" id="pauseat-input" placeholder="0">

                <button id="rate-button">Change playback rate</button>
                <input type="text" id="rate-input" placeholder="1.0">

                <button id="skip-button">Skip to tick</button>
                <input type="text" id="skip-input" placeholder="0">
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
            currentTick: this.server.currentTick
        };
        this._view?.webview.postMessage(message);
        this.last_message = message;
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
