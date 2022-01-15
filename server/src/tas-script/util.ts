import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node";

export class DiagnosticCollector {
    private diagnostics: Diagnostic[] = [];

    addDiagnostic(line: number, startCharacter: number, endCharacter: number, message: string, severity: DiagnosticSeverity = DiagnosticSeverity.Error) {
        this.diagnostics.push({
            range: {
                start: { line: line, character: startCharacter },
                end: { line: line, character: endCharacter },
            },
            message: message,
            severity: severity
        });
    }

    addDiagnosticToLine(line: number, startCharacter: number, message: string, severity: DiagnosticSeverity = DiagnosticSeverity.Error) {
        this.addDiagnostic(line, startCharacter, Number.MAX_VALUE, message, severity);
    }

    getDiagnostics(): Diagnostic[] {
        return this.diagnostics;
    }
}

export type CompletionItemDeclaration = { name: string, description: string };

export const startTypes: CompletionItemDeclaration[] = [
    { name: "map", description: "Starts playing the TAS after loading into the given map." },
    { name: "save", description: "Starts playing the TAS after loading the given save." },
    { name: "cm", description: "Starts playing the TAS after loading into the given map, but in Challenge Mode." },
    { name: "now", description: "Starts playing the TAS immediately, or as soon as a session is started." },
    { name: "next", description: "Starts playing the TAS on the next session start." }
];

export const startCompletion: CompletionItemDeclaration = { name: "start", description: "**Syntax:** ```start <map|save|cm|now|next>```\n\nDefines how the TAS should start. Must be the first statement in a script." };
export const repeatCompletion: CompletionItemDeclaration = { name: "repeat", description: "**Syntax:** ```repeat [iterations]```\n\nMarks the start of a loop that repeats [iterations] times." };
export const endCompletion: CompletionItemDeclaration = { name: "end", description: "**Syntax:** ```end```\n\nMarks the end of a loop. Will produce an error if used without a loop being started." };