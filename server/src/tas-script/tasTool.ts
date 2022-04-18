import { TokenType } from "./tokenizer";

export namespace TASTool {
    export class Tool {
        constructor(
            public tool: string,
            public ticksRemaining?: number
        ) {}

        copy(): Tool {
            return new Tool(this.tool, this.ticksRemaining);
        }
    }

    interface ToolDefinition {
        [name: string]: {
            readonly isOrderDetermined: boolean,
            readonly hasOff: boolean,
            readonly durationIndex: number,
            readonly arguments: ToolArgument[],
            readonly description: string,
        }
    }

    export class ToolArgument {
        constructor(
            readonly type: TokenType,
            readonly required: boolean,
            readonly text?: string,
            readonly unit?: string,
            readonly description?: string,
        ) { }
    }

    export const tools: ToolDefinition = {
        strafe: {
            isOrderDetermined: false,
            hasOff: true,
            durationIndex: -1,
            arguments: [
                { text: "vec", type: TokenType.String, required: false, description: "Enables vectorial strafing (movement analog is adjusted to get desired movement direction). (default)" },
                { text: "ang", type: TokenType.String, required: false, description: "Enables angular strafing (view analog is adjusted to get desired movement direction). This isn't particularly recommended as it doesn't look appealing, however it is the only effective strafing type while on velocity gel." },
                { text: "veccam", type: TokenType.String, required: false, description: "Enables special vectorial strafing that rotates you towards your current moving direction." },
                { text: "max", type: TokenType.String, required: false, description: "Makes autostrafer aim for the greatest acceleration. (default)" },
                { text: "keep", type: TokenType.String, required: false, description: "Makes autostrafer maintain the current velocity." },
                { text: "forward", type: TokenType.String, required: false, description: "Autostrafer will try to strafe in a straight line, towards the current view angle. (default)" },
                { text: "forwardvel", type: TokenType.String, required: false, description: "Autostrafer will try to strafe in a straight line, towards the current velocity angle." },
                { text: "left", type: TokenType.String, required: false, description: "Autostrafer will try to strafe left." },
                { text: "right", type: TokenType.String, required: false, description: "Autostrafer will try to strafe right." },
                { text: "nopitchlock", type: TokenType.String, required: false, description: "Make the autostrafer not clamp the pitch. The autostrafer will always clamp your pitch angle (up and down) between -30 and 30 when midair, as it gives the fastest possible acceleration (forward movement is being scaled by a cosine of that angle while being airborne). This argument will tell the autostrafer that you wish to enable sub-optimal strafing (this is useful when you need to hit a shot while strafing for example)." },
                { type: TokenType.Number, unit: "ups", required: false },
                { type: TokenType.Number, unit: "deg", required: false },
            ],
            description: "**Syntax:** ```strafe [parameters]```\n\nThe strafe tool will adjust player input to get a different kind of strafing depending on parameters.\n\n**Example:** ```strafe 299.999ups left veccam```"
        },
        autojump: {
            isOrderDetermined: false,
            hasOff: true,
            durationIndex: -1,
            arguments: [
                { text: "on", type: TokenType.String, required: false, description: "Enables ```autojump```." },
            ],
            description: "**Syntax:** ```autojump [on]```\n\nAnything other than ```on``` will disable the tool.\n\nAutojump tool will change the jump button state depending on whether the player is grounded or not, resulting in automatically jumping on the earliest contact with a ground.\n\n**Example:** ```autojump on```"
        },
        absmov: {
            isOrderDetermined: false,
            hasOff: true,
            durationIndex: -1,
            arguments: [
                { type: TokenType.Number, required: false },
            ],
            description: "**Syntax:** ```absmov <angle> [strength]```\n\nAbsolute movement tool will generate movement values depending on the absolute move direction you provide in degrees. Giving off as an argument will disable the tool. The strength parameter must be between 0 and 1 (default) and controls how fast the player will move.\n\n**Example:** ```absmov 90 0.5```",
        },
        setang: {
            isOrderDetermined: true,
            hasOff: false,
            durationIndex: 2,
            arguments: [
                { type: TokenType.Number, required: true },
                { type: TokenType.Number, required: true },
                { type: TokenType.Number, required: false },
            ],
            description: "**Syntax:** ```setang <pitch> <yaw> [time]```\n\nThis tool works basically the same as setang console command. It will adjust the view analog in a way so the camera is looking towards given angles.\n\n**Example:** ```setang 0 0 20```"
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
            ],
            description: "**Syntax:** ```autoaim <x> <y> <z> [time]```\n\nThe Auto Aim tool will automatically aim towards a specified point in 3D space.\n\n**Example:** ```autoaim 0 0 0 20```"
        },
        decel: {
            isOrderDetermined: false,
            hasOff: true,
            durationIndex: -1,
            arguments: [
                { type: TokenType.Number, required: false },
            ],
            description: "**Syntax:** ```decel <speed>```\n\nThe decelaration tool will slow down as quickly as possible to the given speed.\n\n**Example:** ```decel 100```"
        }
    };
}