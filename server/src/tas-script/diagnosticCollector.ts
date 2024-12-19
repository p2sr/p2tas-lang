import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node";

/// Helper to collect diagnostics while parsing to return to the client.
export class DiagnosticCollector {
    private static instance: DiagnosticCollector;
    private diagnostics: Diagnostic[] = [];

    constructor() { DiagnosticCollector.instance = this; }

    static addDiagnostic(line: number, startCharacter: number, endCharacter: number, message: string, severity: DiagnosticSeverity = DiagnosticSeverity.Error) {
        this.instance.diagnostics.push({
            range: {
                start: { line: line, character: startCharacter },
                end: { line: line, character: endCharacter },
            },
            message: message,
            severity: severity
        });
    }

    static addDiagnosticToLine(line: number, startCharacter: number, message: string, severity: DiagnosticSeverity = DiagnosticSeverity.Error) {
        this.addDiagnostic(line, startCharacter, Number.MAX_VALUE, message, severity);
    }

    static getDiagnostics(): Diagnostic[] {
        return this.instance.diagnostics;
    }
}