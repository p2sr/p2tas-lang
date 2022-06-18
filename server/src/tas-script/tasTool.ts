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
            readonly unit?: string, // if it ends with a '?', it's optional (see absmov)
            readonly description?: string,
            readonly enablesUpTo?: number,
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
                { text: "letspeedlock", type: TokenType.String, required: false, description: "Let the autostrafer speedlock. This option only exists from version 4 onwards and mimics old behavior." },
                { type: TokenType.Number, unit: "ups", required: false },
                { type: TokenType.Number, unit: "deg", required: false },
            ],
            description: "**Syntax:** ```strafe [parameters]```\n\nThe strafe tool will adjust player input to get a different kind of strafing depending on parameters.\n\n**Example:** ```strafe 299.999ups left veccam```"
        },
        autojump: {
            isOrderDetermined: true,
            hasOff: true,
            durationIndex: -1,
            arguments: [
                { text: "on", type: TokenType.String, required: false, description: "Enables ```autojump```." },
            ],
            description: "**Syntax:** ```autojump [on]```\n\nAnything other than ```on``` will disable the tool.\n\nAutojump tool will change the jump button state depending on whether the player is grounded or not, resulting in automatically jumping on the earliest contact with a ground.\n\n**Example:** ```autojump on```"
        },
        absmov: {
            isOrderDetermined: true,
            hasOff: true,
            durationIndex: -1,
            arguments: [
                { type: TokenType.Number, unit: "deg?", required: false },
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
            isOrderDetermined: true,
            hasOff: true,
            durationIndex: -1,
            arguments: [
                { type: TokenType.Number, unit: "ups?", required: false },
            ],
            description: "**Syntax:** ```decel <speed>```\n\nThe decelaration tool will slow down as quickly as possible to the given speed.\n\n**Example:** ```decel 100```"
        },
        check: {
            isOrderDetermined: true,
            hasOff: false,
            durationIndex: -1,
            arguments: [
                { text: "pos", type: TokenType.String, required: false, enablesUpTo: 3 },
                { type: TokenType.Number, required: true },
                { type: TokenType.Number, required: true },
                { type: TokenType.Number, required: true },
                { text: "ang", type: TokenType.String, required: false, enablesUpTo: 6 },
                { type: TokenType.Number, required: true },
                { type: TokenType.Number, required: true },
                { text: "posepsilon", type: TokenType.String, required: false, enablesUpTo: 8 },
                { type: TokenType.Number, required: true },
                { text: "angepsilon", type: TokenType.String, required: false, enablesUpTo: 10 },
                { type: TokenType.Number, required: true },
            ],
            description: "**Syntax:** ```check [pos x y z] [ang pitch yaw] [posepsilon val] [angepsilon val]```\n\nThe check tool accepts a target position and angle, and a precision value (posepsilon (default: 0.5), angepsilon (default: 0.2)). **Before** the tick it is on, it will check whether the player position is close to (meaning \"within posepsilon / angepsilon units\") the target position, and if not, replay the active script. It will do this a maximum of ```sar_tas_check_max_replays``` (default 15) times.\n\n**Example:** ```check pos 100 250 312.7```"
        }
    };
}