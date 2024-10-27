import { TokenType } from "./tokenizer";

export namespace TASTool {
    export class Tool {
        constructor(
            public tool: string,
            /** The line at which the tool was invoked. */
            public fromLine: number,
            /** The column on the `fromLine` at which the tool invocation starts (first character of the tool name). */
            public startCol: number,
            /** The column on the `fromLine` at which the tool invocation ends (character after the last argument). */
            public endCol: number,
            public ticksRemaining?: number,
        ) { }

        copy(): Tool {
            return new Tool(this.tool, this.fromLine, this.startCol, this.endCol, this.ticksRemaining);
        }
    }

    interface ToolDefinition {
        [name: string]: {
            /**  Whether the arguments of this tool have a fixed order. */
            readonly hasFixedOrder: boolean,
            /**
             * Whether the tool has an "off" argument. This is treated separately, as it should always
             * appear on its own and should not be suggested if other arguments are present.
             */
            readonly hasOff: boolean,
            /**  The index of the argument in `arguments` that defines for how long the tool runs. */
            readonly durationIndex: number,
            readonly arguments: ToolArgument[],
            readonly description: string,
            /**  Index of the tool in SAR's execution order (minus 1) (used only in version >= 3). */
            readonly index: number,
        }
    }

    export class ToolArgument {
        constructor(
            readonly type: TokenType,
            readonly required: boolean,
            readonly text?: string,
            /** If the unit ends with a '?', it is optional (e.g. absmov). */
            readonly unit?: string,
            readonly description?: string,
            /**
             * The arguments that need to be present if this argument is used (e.g. when a tool
             * takes a keyword and a "parameter" for the keyword, as in "autoaim ent <entity>")
             */
            readonly children?: ToolArgument[],
            /**
             * This argument's children if the argument isn't used (e.g. autoaim takes either an
             * entity or a coordinate) (better name?!)
             */
            readonly otherwiseChildren?: ToolArgument[],
        ) { }
    }

    export const tools: ToolDefinition = {
        check: {
            hasFixedOrder: true,
            hasOff: false,
            durationIndex: 100, // janky hack to make this never show as an active tool
            arguments: [
                {
                    text: "pos", type: TokenType.String, required: false, children: [
                        { type: TokenType.Number, required: true },
                        { type: TokenType.Number, required: true },
                        { type: TokenType.Number, required: true },
                    ]
                },
                {
                    text: "ang", type: TokenType.String, required: false, children: [
                        { type: TokenType.Number, required: true },
                        { type: TokenType.Number, required: true },
                    ]
                },
                {
                    text: "posepsilon", type: TokenType.String, required: false, children: [
                        { type: TokenType.Number, required: true },
                    ]
                },
                {
                    text: "angepsilon", type: TokenType.String, required: false, children: [
                        { type: TokenType.Number, required: true },
                    ]
                },
            ],
            description: "**Syntax:** ```check [pos x y z] [ang pitch yaw] [posepsilon val] [angepsilon val]```\n\nThe check tool accepts a target position and angle, and a precision value (posepsilon (default: 0.5), angepsilon (default: 0.2)). **Before** the tick it is on, it will check whether the player position is close to (meaning \"within posepsilon / angepsilon units\") the target position, and if not, replay the active script. It will do this a maximum of ```sar_tas_check_max_replays``` (default 15) times.\n\n**Example:** ```check pos 100 250 312.7```",
            index: 0,
        },
        stop: {
            isOrderDetermined: true,
            hasOff: false,
            durationIndex: -1,
            arguments: [],
            description: "**Syntax:** ```stop```\n\nStops every tool activated prior to given tick.\n\n**Example:** ```stop```",
            index: 2
        },
        use: {
            isOrderDetermined: true,
            hasOff: false,
            durationIndex: -1,
            arguments: [
                { text: "spam", type: TokenType.String, required: false, description: "Spams ```+use``` every other tick" },
            ],
            description: "**Syntax:** ```use [spam]```\n\nPresses the ```+use``` input. It also has an option for spamming, which will spam +use every other tick.\n\n**Example:** ```use spam```",
            index: 3
        },
        duck: {
            isOrderDetermined: true,
            hasOff: false,
            durationIndex: 0,
            arguments: [
                { type: TokenType.Number, required: false }
            ],
            description: "**Syntax:** ```duck [duration]```\n\nPresses the duck input. Can take a number parameter for a duration.\n\n**Example:** ```duck 20```",
            index: 4
        },
        zoom: {
            isOrderDetermined: true,
            hasOff: false,
            durationIndex: -1,
            arguments: [
                { text: "in", type: TokenType.String, required: false, description: "Zooms in" },
                { text: "out", type: TokenType.String, required: false, description: "Zooms out" },
            ],
            description: "**Syntax:** ```zoom [action]```\n\nUsed for zooming in and out. Also detects whether to press an input based on whether you're zooming or not.\n\n**Example:** ```zoom in```",
            index: 5
        },
        shoot: {
            hasFixedOrder: true,
            hasOff: false,
            durationIndex: -1,
            arguments: [
                { text: "blue", type: TokenType.String, required: false, description: "Shoots the blue portal" },
                { text: "orange", type: TokenType.String, required: false, description: "Shoots the orange portal" },
                { text: "spam", type: TokenType.String, required: false, description: "Automates spamming, automatically detecting the portal gun's cooldown" },
            ],
            description: "**Syntax:** ```shoot [portal]```\n\nUsed to shoot portals. Can automate spamming with the ```spam``` property, which will automatically detect the portal gun's cooldown.\n\n**Example:** ```shoot blue```",
            index: 6
        },
        setang: {
            hasFixedOrder: true,
            hasOff: false,
            durationIndex: 3,
            arguments: [
                { type: TokenType.Number, required: true },
                { type: TokenType.Number, required: true },
                { type: TokenType.Number, required: false },
                { type: TokenType.String, required: false, description: "Easing type for the setang among: `cubic`, `exp`/`exponential`, `linear` or `sin`/`sine`" },
            ],
            description: "**Syntax:** ```setang <pitch> <yaw> [time] [easing]```\n\nThis tool works basically the same as setang console command. It will adjust the view analog in a way so the camera is looking towards given angles.\n\n**Example:** ```setang 0 0 20```",
            index: 7,
        },
        autoaim: {
            hasFixedOrder: true,
            hasOff: true,
            durationIndex: 3,
            arguments: [
                {
                    type: TokenType.String, text: "ent", required: false, children: [
                        { type: TokenType.String, required: true },
                    ], otherwiseChildren: [
                        { type: TokenType.Number, required: true },
                        { type: TokenType.Number, required: true },
                        { type: TokenType.Number, required: true },
                    ]
                },
                { type: TokenType.Number, required: false },
            ],
            description: "**Syntax:** ```autoaim [ent] <x> <y> <z> [time]```\n\nThe Auto Aim tool will automatically aim towards a specified point in 3D space.\n\n**Example:** ```autoaim 0 0 0 20```",
            index: 8,
        },
        autojump: {
            hasFixedOrder: true,
            hasOff: true,
            durationIndex: -1,
            arguments: [
                { text: "on", type: TokenType.String, required: false, description: "Enables ```autojump```." },
                { text: "ducked", type: TokenType.String, required: false, description: "Enables ```autojump``` while also ducking. Ducking slightly increases your jump height." },
            ],
            description: "**Syntax:** ```autojump [on]```\n\nAnything other than ```on``` will disable the tool.\n\nAutojump tool will change the jump button state depending on whether the player is grounded or not, resulting in automatically jumping on the earliest contact with a ground.\n\n**Example:** ```autojump on```",
            index: 10,
        },
        absmov: {
            hasFixedOrder: true,
            hasOff: true,
            durationIndex: -1,
            arguments: [
                { type: TokenType.Number, unit: "deg?", required: false },
                { type: TokenType.Number, required: false },
            ],
            description: "**Syntax:** ```absmov <angle> [strength]```\n\nAbsolute movement tool will generate movement values depending on the absolute move direction you provide in degrees. Giving off as an argument will disable the tool. The strength parameter must be between 0 and 1 (default) and controls how fast the player will move.\n\n**Example:** ```absmov 90 0.5```",
            index: 11,
        },
        strafe: {
            hasFixedOrder: false,
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
            description: "**Syntax:** ```strafe [parameters]```\n\nThe strafe tool will adjust player input to get a different kind of strafing depending on parameters.\n\n**Example:** ```strafe 299.999ups left veccam```",
            index: 13,
        },
        decel: {
            hasFixedOrder: true,
            hasOff: true,
            durationIndex: -1,
            arguments: [
                { type: TokenType.Number, unit: "ups?", required: false },
            ],
            description: "**Syntax:** ```decel <speed>```\n\nThe decelaration tool will slow down as quickly as possible to the given speed.\n\n**Example:** ```decel 100```",
            index: 14,
        }
    };
}
