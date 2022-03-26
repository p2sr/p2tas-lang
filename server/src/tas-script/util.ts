import { Diagnostic, DiagnosticSeverity, Position } from "vscode-languageserver/node";

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

export class CommentRange {
    start: number;
    end: number;
    isWholeLine: boolean;

    constructor(start: number, end: number, isWholeLine: boolean = false) {
        this.start = start;
        this.end = end;
        this.isWholeLine = isWholeLine;
    }

    containsPos(pos: Position): boolean {
        return pos.character >= this.start && pos.character <= this.end;
    }
}

export interface StartTypes {
    [name: string]: StartType
};

export type StartType = {
    hasArgument?: boolean,
    description: string,
};

export const startTypes: StartTypes = {
    map: {
        hasArgument: true,
        description: "Starts playing the TAS after loading into the given map."
    },
    save: {
        hasArgument: true,
        description: "Starts playing the TAS after loading the given save."
    },
    cm: {
        hasArgument: true,
        description: "Starts playing the TAS after loading into the given map, but in Challenge Mode."
    },
    now: {
        description: "Starts playing the TAS immediately, or as soon as a session is started."
    },
    next: {
        description: "Starts playing the TAS on the next session start."
    }
}

export type CompletionItemDeclaration = { name: string, description: string };

export const startCompletion: CompletionItemDeclaration = { name: "start", description: "**Syntax:** ```start <map|save|cm|now|next>```\n\nDefines how the TAS should start. Must be the first statement in a script." };
export const endCompletion: CompletionItemDeclaration = { name: "end", description: "**Syntax:** ```end```\n\nMarks the end of a loop. Will produce an error if used without a loop being started." };