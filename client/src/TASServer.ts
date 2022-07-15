import * as vscode from 'vscode';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import { platform } from 'process';
import { TASSidebarProvider } from './sidebar';

export enum TASStatus {
    Inactive, Playing, Paused, Skipping
}

export class TASServer {
    static host = 'localhost';
    static port = 6555;
    socket: net.Socket;

    connected = false;

    userConfirmFieldChanges = true;

    // Some callbacks set by the root extension code to handle debug highlight
    onRequestPlayback: ((doc: vscode.TextDocument) => void) | null = null;
    onDataUpdate: (() => void) | null = null;

    // This data should only be updated from SAR data
    gameLocation: string | undefined;
    activeTASses = ['', '']; // Should always be of length 2
    playbackRate = 1.0;
    status = TASStatus.Inactive;
    currentTick = 0; // Only valid when active
    debugTick = -1;

    webView: TASSidebarProvider | undefined;

    constructor() {
        this.socket = new net.Socket();
    }

    connect() {
        if (this.connected) return;

        this.socket.connect(TASServer.port, TASServer.host, () => {
            vscode.window.showInformationMessage("Successfully connected to SAR!");
            this.connected = true;
        });
        this.socket.on('error', () => vscode.window.showInformationMessage("Failed to connect to SAR."));
        this.socket.on('close', () => {
            vscode.window.showInformationMessage("Closed connection to SAR.");
            this.connected = false;
            if (this.webView !== undefined)
                this.webView.updateWebView();
            if (this.onDataUpdate) this.onDataUpdate();
        });
        this.socket.on('data', (data) => {
            this.processData(data);
            if (this.webView !== undefined)
                this.webView.updateWebView();
            if (this.onDataUpdate) this.onDataUpdate();
        });
    }

    disconnect() {
        this.socket.destroy();
    }

    // ----------------------------------------------
    //                 Sending data
    // ----------------------------------------------

    async requestToolsPlayback() {
        const document = vscode.window.activeTextEditor?.document

        await document?.save();

        var filename = document?.fileName;
        if (filename === undefined) return;

        if (this.onRequestPlayback !== null) this.onRequestPlayback(vscode.window.activeTextEditor?.document);

        this.requestPlayback(filename);
    }
    requestRawPlayback() {
        // No need to save for raw, the file should already be generated
        var filename = vscode.window.activeTextEditor?.document?.fileName;
        if (filename === undefined) return;

        if (this.onRequestPlayback !== null) this.onRequestPlayback(vscode.window.activeTextEditor?.document);

        filename = filename.replace(".p2tas", "_raw.p2tas");
        this.requestPlayback(filename);
    }
    requestPlayback(scriptPath: string) {
        if (!this.checkSocket())
            return;

        scriptPath = fs.realpathSync(path.normalize(scriptPath));

        // If we have no game location, get the plain filename and hope for the best
        if (this.gameLocation === undefined) {
            scriptPath = path.basename(scriptPath);
        } else {
            const tasFolder = fs.realpathSync(path.join(this.gameLocation, "/tas"));

            // On windows, compare lowercase cause shenanigans
            var condition: boolean;
            if (platform === 'win32') {
                condition = !scriptPath.toLowerCase().startsWith(tasFolder.toLowerCase());
            } else {
                condition = !scriptPath.startsWith(tasFolder);
            }
            if (condition) {
                vscode.window.showErrorMessage("Failed to play: file is not in the `Portal 2/tas` directory.");
                return;
            }

            scriptPath = path.relative(tasFolder, scriptPath);
        }

        // Check it's actually a p2tas
        if (!scriptPath.endsWith(".p2tas")) {
            vscode.window.showErrorMessage("Failed to play: file is not a TAS script.");
            return;
        }
        scriptPath = scriptPath.slice(0, scriptPath.length - 6); // remove extension

        vscode.window.showInformationMessage("Requesting playback for file " + scriptPath);

        var buf = Buffer.alloc(9 + scriptPath.length, 0);
        buf.writeUInt32BE(scriptPath.length, 1);
        buf.write(scriptPath, 5);
        buf.writeUInt32BE(0, 5 + scriptPath.length);

        this.socket.write(buf);
    }
    requestStopPlayback() {
        if (!this.checkSocket())
            return;
        this.socket.write(Buffer.alloc(1, 1));
    }
    requestRatePlayback(rate: number) {
        if (!this.checkSocket())
            return;
        var buf = Buffer.alloc(5, 2);
        buf.writeFloatBE(rate, 1);
        this.socket.write(buf);
    }
    requestStatePlaying() {
        if (!this.checkSocket())
            return;
        this.socket.write(Buffer.alloc(1, 3));
    }
    requestStatePaused() {
        if (!this.checkSocket())
            return;
        this.socket.write(Buffer.alloc(1, 4));
    }
    requestFastForward(tick: number, pause_after: boolean) {
        if (!this.checkSocket())
            return;
        var buf = Buffer.alloc(6, 5);
        buf.writeUInt32BE(tick, 1);
        if (pause_after)
            buf.writeUInt8(1, 5);
        else
            buf.writeUInt8(0, 5);
        this.socket.write(buf);
    }
    requestNextPauseTick(tick: number) {
        if (!this.checkSocket())
            return;
        var buf = Buffer.alloc(5, 6);
        buf.writeUInt32BE(tick, 1);
        this.socket.write(buf);
    }
    requestTickAdvance() {
        if (!this.checkSocket())
            return;
        this.socket.write(Buffer.alloc(1, 7));
    }

    // ----------------------------------------------
    //                Receiving data
    // ----------------------------------------------

    processData(data: Buffer) {
        while (data.length !== 0) {
            switch (data[0]) {
                case 0: // Active TAS files
                    // File for blue/sp
                    const len1 = data.readUInt32BE(1);
                    this.activeTASses[0] = data.toString(undefined, 5, 5 + len1);
                    data = data.slice(5 + len1);

                    // File for orange
                    const len2 = data.readUInt32BE(0);
                    this.activeTASses[1] = data.toString(undefined, 5, 4 + len2);
                    data = data.slice(4 + len2);
                    break;

                case 1: // Set inactive
                    this.status = TASStatus.Inactive;
                    data = data.slice(1);
                    break;

                case 2: // Update playback rate
                    this.playbackRate = data.readFloatBE(1);
                    data = data.slice(5);
                    break;

                case 3: // State = playing
                    this.status = TASStatus.Playing;
                    data = data.slice(1);
                    break;

                case 4: // State = paused
                    this.status = TASStatus.Paused;
                    data = data.slice(1);
                    break;

                case 5: // State = skipping
                    this.status = TASStatus.Skipping;
                    data = data.slice(1);
                    break;

                case 6: // update current tick
                    this.currentTick = data.readUInt32BE(1);
                    data = data.slice(5);
                    break;

                case 7: // update debug tick
                    this.debugTick = data.readInt32BE(1);
                    data = data.slice(5);
                    break;

                case 255: // Game location
                    const len = data.readUInt32BE(1);
                    this.gameLocation = fs.realpathSync(path.normalize(data.toString(undefined, 5, 5 + len)));
                    data = data.slice(5 + len);
                    break;

                default: // Bad packet ID, ignore 
                    break;
            }
        }
    }

    setConfirmFieldChanges(confirmFieldChanges: boolean) {
        this.userConfirmFieldChanges = confirmFieldChanges;
        this.webView?.updateWebView();
    }

    // ----------------------------------------------
    //                    Utils
    // ----------------------------------------------

    checkSocket(): boolean {
        if (this.socket === undefined) {
            vscode.window.showErrorMessage("Not connected to SAR.");
            return false;
        }

        if (this.socket.connecting) {
            vscode.window.showErrorMessage("Socket connecting.... Please try again later.");
            return false;
        }

        if (this.socket.destroyed) {
            vscode.window.showErrorMessage("Socket disconnected.... Please connect to SAR.");
            return false;
        }

        return this.connected;
    }
}
