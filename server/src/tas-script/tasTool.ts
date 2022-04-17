import { TokenType } from "./tokenizer";

export namespace TASTool {
    interface ToolDefinition {
        [name: string]: {
            readonly isOrderDetermined: boolean,
            readonly hasOff: boolean,
            readonly durationIndex: number,
            readonly arguments: ToolArgument[],
        }
    }

    export class ToolArgument {
        constructor(
            readonly type: TokenType,
            readonly required: boolean,
            readonly text?: string,
            readonly unit?: string,
        ) { }
    }

    export const tools: ToolDefinition = {
        strafe: {
            isOrderDetermined: false,
            hasOff: true,
            durationIndex: -1,
            arguments: [
                { text: "vec", type: TokenType.String, required: false },
                { text: "ang", type: TokenType.String, required: false },
                { text: "veccam", type: TokenType.String, required: false },
                { text: "max", type: TokenType.String, required: false },
                { text: "keep", type: TokenType.String, required: false },
                { text: "forward", type: TokenType.String, required: false },
                { text: "forwardvel", type: TokenType.String, required: false },
                { text: "left", type: TokenType.String, required: false },
                { text: "right", type: TokenType.String, required: false },
                { text: "nopitchlock", type: TokenType.String, required: false },
                { type: TokenType.Number, unit: "ups", required: false },
                { type: TokenType.Number, unit: "deg", required: false },
            ]
        },
        autojump: {
            isOrderDetermined: false,
            hasOff: true,
            durationIndex: -1,
            arguments: [
                { text: "on", type: TokenType.String, required: false },
            ]
        },
        absmov: {
            isOrderDetermined: false,
            hasOff: true,
            durationIndex: -1,
            arguments: [
                { type: TokenType.Number, required: false },
            ]
        },
        setang: {
            isOrderDetermined: true,
            hasOff: false,
            durationIndex: 2,
            arguments: [
                { type: TokenType.Number, required: true },
                { type: TokenType.Number, required: true },
                { type: TokenType.Number, required: false },
            ]
        },
        autoaim: {
            isOrderDetermined: true,
            hasOff: true,
            durationIndex: 3,
            arguments: [
                { type: TokenType.Number, required: true },
                { type: TokenType.Number, required: true },
                { type: TokenType.Number, required: true },
                { type: TokenType.Number, required: false },
            ]
        },
        decel: {
            isOrderDetermined: false,
            hasOff: true,
            durationIndex: -1,
            arguments: [
                { type: TokenType.Number, required: false },
            ]
        }
    };
}