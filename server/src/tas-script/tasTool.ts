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

    export enum ActiveUsageType {
        None,
        Manual,
        Duration,
    }

    export enum BulkType {
        Movement = 1 << 0,
        ViewAngles = 1 << 1,
        Buttons = 1 << 2,
        Commands = 1 << 3,
        Meta = 1 << 4,
        All = (Movement | ViewAngles | Buttons | Commands | Meta)
    }

    export enum MetaToolType {
        Stop
    }

    interface ToolDefinition {
        [name: string]: {
            readonly bulkType: BulkType,
            /**  Whether the arguments of this tool have a fixed order. */
            readonly hasFixedOrder: boolean,
            /**
             * Whether the tool has an "off" argument. This is treated separately, as it should always
             * appear on its own and should not be suggested if other arguments are present.
             */
            readonly hasOff: boolean,
            readonly metaToolType?: MetaToolType,
            /**
             * Whether this tool should be added to the list of running tools when it is activated.
             * If set to `None`, never adds the tool to the list of active tools. (tool executes once without lasting effects)
             * If set to `Manual`, tool is added to a list, and then removed when "off" argument or "stop" tool is used.
             * If set to `Duration`, acts like `Manual`, but can also be removed when duration specified by an argument is passed.
             */
            readonly activeUsageType: ActiveUsageType,
            readonly arguments: ToolArgument[],
            readonly expectsArguments: boolean,
            /**
             * If set to `true` and tool has no native arguments, bypass argument error checking for this tool.
             * Effectively allows anything to be parsed as arguments to the tool without giving errors.
             */
            readonly allowArbitraryArguments: boolean,
            readonly description: string,
            /**
             * Index of the tool in SAR's execution order This is only used in version >= 3.
             *
             * @see https://github.com/p2sr/SourceAutoRecord/blob/master/src/Features/Tas/TasTool.cpp#L18
             */
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
             * If set, overrides tool's active usage type. 
             * Can be used to set up optional active usage or to create "off" alias.
             */
            readonly activeUsageTypeOverride?: ActiveUsageType,
            /**
             * Is the argument defining how long its tool runs.
             */
            readonly isDuration?: boolean,
            /**
             * Custom payload that can be used by meta parameters
             */
            readonly customPayload?: any,
            /**
             * The arguments that need to be present if this argument is used (e.g. when a tool
             * takes a keyword and a "parameter" for the keyword, as in "autoaim ent <entity>")
             */
            readonly children?: ToolArgument[],
            /**
             * This argument's children if the argument isn't used (e.g. autoaim takes either an
             * entity or a coordinate) (better name?!) (nah this needs to be completely rewritten imho)
             */
            readonly otherwiseChildren?: ToolArgument[],
        ) { }
    }

    export const tools: ToolDefinition = {
        check: {
            bulkType: BulkType.Meta,
            hasFixedOrder: true,
            hasOff: false,
            activeUsageType: ActiveUsageType.None,
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
                {
                    text: "vel", type: TokenType.String, required: false, children: [
                        { type: TokenType.String, required: true, description: "Velocity components to check: `x`, `y`, `z`, `xy`, `xz`, `yz`, or `xyz`" },
                        { type: TokenType.Number, required: true },
                    ]
                },
                {
                    text: "velepsilon", type: TokenType.String, required: false, children: [
                        { type: TokenType.Number, required: true },
                    ]
                },
                {
                    text: "holding", type: TokenType.String, required: false, children: [
                        { type: TokenType.String, required: false, description: "Optional entity selector to check for a specific held prop" },
                    ]
                },
            ],
            expectsArguments: true,
            allowArbitraryArguments: false,
            description: "**Syntax:** ```check [pos x y z] [ang pitch yaw] [posepsilon val] [angepsilon val] [vel components val] [velepsilon val] [holding entity_name]```\n\nThe check tool accepts a target position and angle, and a precision value (posepsilon (default: 0.5), angepsilon (default: 0.2)). **Before** the tick it is on, it will check whether the player position is close to (meaning \"within posepsilon / angepsilon units\") the target position, and if not, replay the active script. It will do this a maximum of ```sar_tas_check_max_replays``` (default 15) times.\n\n**Example:** ```check pos 100 250 312.7```",
            index: 0,
        },
        cmd: {
            bulkType: BulkType.Commands,
            hasFixedOrder: false,
            hasOff: false,
            activeUsageType: ActiveUsageType.None,
            arguments: [],
            expectsArguments: true,
            allowArbitraryArguments: true,
            description: "**Syntax:** ```cmd <command>```\n\nRuns the provided console command. Not encased in quotes.\n\n**Example:** ```cmd say hello world!```",
            index: 1
        },
        stop: {
            metaToolType: MetaToolType.Stop,
            bulkType: BulkType.Meta,
            hasFixedOrder: false,
            hasOff: false,
            activeUsageType: ActiveUsageType.None,
            arguments: [
                { text: "movement", type: TokenType.String, required: false, customPayload: BulkType.Movement },
                { text: "moving", type: TokenType.String, required: false, customPayload: BulkType.Movement },
                { text: "move", type: TokenType.String, required: false, customPayload: BulkType.Movement },
                { text: "viewangles", type: TokenType.String, required: false, customPayload: BulkType.ViewAngles },
                { text: "angles", type: TokenType.String, required: false, customPayload: BulkType.ViewAngles },
                { text: "ang", type: TokenType.String, required: false, customPayload: BulkType.ViewAngles },
                { text: "looking", type: TokenType.String, required: false, customPayload: BulkType.ViewAngles },
                { text: "look", type: TokenType.String, required: false, customPayload: BulkType.ViewAngles },
                { text: "buttons", type: TokenType.String, required: false, customPayload: BulkType.Buttons },
                { text: "inputs", type: TokenType.String, required: false, customPayload: BulkType.Buttons },
                { text: "pressing", type: TokenType.String, required: false, customPayload: BulkType.Buttons },
                { text: "press", type: TokenType.String, required: false, customPayload: BulkType.Buttons },
                { text: "all", type: TokenType.String, required: false, customPayload: BulkType.All },
                { text: "everything", type: TokenType.String, required: false, customPayload: BulkType.All },
            ],
            expectsArguments: false,
            allowArbitraryArguments: false,
            description: "**Syntax:** ```stop [types]```\n\nStops all tools activated in prior tickbulks. Optionally accepts type parameters to stop only tools of a given type.\n\n**Example:** ```stop movement```",
            index: 2
        },
        use: {
            bulkType: BulkType.Buttons,
            hasFixedOrder: true,
            hasOff: true,
            activeUsageType: ActiveUsageType.None,
            arguments: [
                { text: "spam", type: TokenType.String, required: false, activeUsageTypeOverride: ActiveUsageType.Manual, description: "Spams ```+use``` every other tick until disabled with `off`"},
            ],
            expectsArguments: false,
            allowArbitraryArguments: false,
            description: "**Syntax:** ```use [spam/off]```\n\nPresses the ```+use``` input once. Passing `spam` will spam +use every other tick until disabled with `off`.\n\n**Example:** ```use spam```",
            index: 3
        },
        duck: {
            bulkType: BulkType.Buttons,
            hasFixedOrder: true,
            hasOff: true,
            activeUsageType: ActiveUsageType.None,
            arguments: [
                {
                    text: "on", type: TokenType.String, required: false, description: "Enables ```duck```.", otherwiseChildren: [
                        { type: TokenType.Number, required: false, isDuration: true, activeUsageTypeOverride: ActiveUsageType.Duration }
                    ]
                }
            ],
            expectsArguments: false,
            allowArbitraryArguments: false,
            description: "**Syntax:** ```duck [duration]```\n\nPresses the duck input. Can take a number parameter for a duration.\n\n**Example:** ```duck 20```",
            index: 4
        },
        zoom: {
            bulkType: BulkType.Buttons,
            hasFixedOrder: true,
            hasOff: false,
            activeUsageType: ActiveUsageType.None,
            arguments: [
                { text: "in", type: TokenType.String, required: false, description: "Zooms in" },
                { text: "out", type: TokenType.String, required: false, description: "Zooms out" },
                { text: "toggle", type: TokenType.String, required: false, description: "Toggles zoom" }
            ],
            expectsArguments: true,
            allowArbitraryArguments: false,
            description: "**Syntax:** ```zoom [action]```\n\nUsed for zooming in and out. Also detects whether to press an input based on whether you're zooming or not.\n\n**Example:** ```zoom in```",
            index: 5
        },
        shoot: {
            bulkType: BulkType.Buttons,
            hasFixedOrder: false,
            hasOff: true,
            activeUsageType: ActiveUsageType.None,
            arguments: [
                { text: "blue", type: TokenType.String, required: false, description: "Shoots the blue portal" },
                { text: "orange", type: TokenType.String, required: false, description: "Shoots the orange portal" },
                { text: "hold", type: TokenType.String, required: false, activeUsageTypeOverride: ActiveUsageType.Manual, description: "Holds the shoot input until disabled with `off`" },
                { text: "spam", type: TokenType.String, required: false, activeUsageTypeOverride: ActiveUsageType.Manual, description: "Spams the shoot input with respect to the portal gun's fire delay until disabled with `off`" },
            ],
            expectsArguments: true,
            allowArbitraryArguments: false,
            description: "**Syntax:** ```shoot <blue/orange> [hold] [spam]```\n\nUsed to shoot portals. Can automate spamming with the ```spam``` property, which will automatically detect the portal gun's cooldown.\n\n**Example:** ```shoot blue```",
            index: 6
        },
        setang: {
            bulkType: BulkType.ViewAngles,
            hasFixedOrder: true,
            hasOff: true,
            activeUsageType: ActiveUsageType.Duration,
            arguments: [
                {
                    text: "ahead", type: TokenType.String, required: false,
                    description: "Looks towards the current direction of movement",
                    otherwiseChildren: [
                        { type: TokenType.Number, required: true, description: "Pitch angle" },
                        { type: TokenType.Number, required: true, description: "Yaw angle" },
                    ]
                },
                { type: TokenType.Number, required: false, description: "Interpolation time in ticks", isDuration: true },
                { type: TokenType.String, required: false, description: "Easing type" },
            ],
            expectsArguments: true,
            allowArbitraryArguments: false,
            description: "**Syntax:** ```setang <pitch> <yaw> [time] [easing]```\n\nThis tool works basically the same as setang console command. It will adjust the view analog in a way so the camera is looking towards given angles.\n\n**Example:** ```setang 0 0 20```",
            index: 7,
        },
        autoaim: {
            bulkType: BulkType.ViewAngles,
            hasFixedOrder: true,
            hasOff: true,
            activeUsageType: ActiveUsageType.Manual,
            arguments: [
                {
                    type: TokenType.String, text: "ent", required: false, children: [
                        {
                            type: TokenType.String, required: false, otherwiseChildren: [
                                { type: TokenType.Number, required: true }
                            ]
                        },
                    ], otherwiseChildren: [
                        { type: TokenType.Number, required: true },
                        { type: TokenType.Number, required: true },
                        { type: TokenType.Number, required: true },
                    ]
                },
                { type: TokenType.Number, required: false, isDuration: true, description: "Easing time in ticks"},
                { type: TokenType.String, required: false, description: "Specifies which algorithm to use for interpolation. Options are `cubic`, `exp`/`exponential`, `linear` or `sin`/`sine`. If omitted, `linear` is used." }
            ],
            expectsArguments: true,
            allowArbitraryArguments: false,
            description: "**Syntax:** ```autoaim [ent] <x> <y> <z> [time] [easing]```\n\nThe Auto Aim tool will automatically aim towards a specified point in 3D space.\n\n**Example:** ```autoaim 0 0 0 20```",
            index: 8,
        },
        look: {
            bulkType: BulkType.ViewAngles,
            hasFixedOrder: true,
            hasOff: true,
            activeUsageType: ActiveUsageType.Duration,
            arguments: [
                {
                    text: "stop", activeUsageTypeOverride: ActiveUsageType.None, type: TokenType.String, required: false, otherwiseChildren: [
                        {
                            type: TokenType.Number, unit: "deg", required: false, children: [
                                { type: TokenType.Number, unit: "deg", required: true }
                            ], otherwiseChildren: [
                                { type: TokenType.String, required: true },
                                { type: TokenType.String, required: false }
                            ]
                        }
                    ]
                },
                { type: TokenType.Number, required: false, description: "Look duration, in ticks", isDuration: true }
            ],
            expectsArguments: true,
            allowArbitraryArguments: false,
            description: "**Syntax:** ```look <pitch> <yaw> [time]```\n\nCan be used to control the view analog. It also accepts additional parameters, like word-based directions or time.\n\n**Example:** ```look 10deg 173deg 10```",
            index: 9
        },
        jump: {
            bulkType: BulkType.Buttons,
            hasFixedOrder: true,
            hasOff: false,
            activeUsageType: ActiveUsageType.None,
            arguments: [
                { text: "duck", type: TokenType.String, required: false, description: "Jumps while also ducking. Ducking slightly increases your jump height." },
                { text: "ducked", type: TokenType.String, required: false, description: "Jumps while also ducking. Ducking slightly increases your jump height." },
                { text: "unducked", type: TokenType.String, required: false, description: "Jumps without ducking." },
            ],
            expectsArguments: false,
            allowArbitraryArguments: false,
            description: "**Syntax:** ```jump [duck|ducked]```\n\nCan be used to execute single-tick jump input. Equivalent of using button tickbulk\n\n**Example:** ```jump ducked```",
            index: 10,
        },
        autojump: {
            bulkType: BulkType.Buttons,
            hasFixedOrder: true,
            hasOff: true,
            activeUsageType: ActiveUsageType.Manual,
            arguments: [
                { text: "on", type: TokenType.String, required: false, description: "Enables ```autojump```." },
                { text: "duck", type: TokenType.String, required: false, description: "Enables ```autojump``` while also ducking. Ducking slightly increases your jump height." },
                { text: "ducked", type: TokenType.String, required: false, description: "Enables ```autojump``` while also ducking. Ducking slightly increases your jump height." },
                { text: "unducked", type: TokenType.String, required: false, description: "Enables ```autojump``` without ducking." },
            ],
            expectsArguments: true,
            allowArbitraryArguments: false,
            description: "**Syntax:** ```autojump [on|duck|ducked|unducked]```\n\nAutojump tool will change the jump button state depending on whether the player is grounded or not, resulting in automatically jumping on the earliest contact with a ground.\n\n**Example:** ```autojump on```",
            index: 11,
        },
        absmov: {
            bulkType: BulkType.Movement,
            hasFixedOrder: true,
            hasOff: true,
            activeUsageType: ActiveUsageType.Manual,
            arguments: [
                { type: TokenType.Number, unit: "deg?", required: false },
                { type: TokenType.Number, required: false },
            ],
            expectsArguments: true,
            allowArbitraryArguments: false,
            description: "**Syntax:** ```absmov <angle> [strength]```\n\nAbsolute movement tool will generate movement values depending on the absolute move direction you provide in degrees. Giving off as an argument will disable the tool. The strength parameter must be between 0 and 1 (default) and controls how fast the player will move.\n\n**Example:** ```absmov 90 0.5```",
            index: 12,
        },
        move: {
            bulkType: BulkType.Movement,
            hasFixedOrder: true,
            hasOff: true,
            activeUsageType: ActiveUsageType.Manual,
            arguments: [
                {
                    text: "stop", activeUsageTypeOverride: ActiveUsageType.None, type: TokenType.String, required: false, otherwiseChildren: [
                        {
                            type: TokenType.Number, unit: "deg", required: false, otherwiseChildren: [
                                { type: TokenType.String, required: true },
                                { type: TokenType.String, required: false }
                            ]
                        },
                        { type: TokenType.Number, required: false, description: "Scale factor" }
                    ]
                }
            ],
            expectsArguments: true,
            allowArbitraryArguments: false,
            description: "**Syntax:** ```move <direction> [scale]```\n\nControls the movement analog. Can accept 1-2 direction parameters, as well as word-based parameters.\n\n**Example:** ```move forward left```",
            index: 13
        },
        strafe: {
            bulkType: BulkType.Movement,
            hasFixedOrder: false,
            hasOff: true,
            activeUsageType: ActiveUsageType.Manual,
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
                { type: TokenType.Number, unit: "ups", required: false, description: "Target horizontal velocity in units per second" },
                { type: TokenType.Number, unit: "deg", required: false, description: "Target direction angle in degrees" },
                { type: TokenType.Number, unit: "usdeg", required: false, description: "Understrafe offset in degrees — brings movement vector closer to velocity vector for a weaker turn" },
                { type: TokenType.Number, unit: "osdeg", required: false, description: "Overstrafe offset in degrees — brings movement vector further from velocity vector for a bigger turn" },
                { type: TokenType.Number, unit: "us", required: false, description: "Understrafe scalar (1us = closest direction yielding no acceleration)" },
                { type: TokenType.Number, unit: "os", required: false, description: "Overstrafe scalar (1os = closest direction yielding no acceleration)" },
                { type: TokenType.Number, required: false, description: "Input strength — movement input vector is scaled by this value" },
            ],
            expectsArguments: true,
            allowArbitraryArguments: false,
            description: "**Syntax:** ```strafe [parameters]```\n\nThe strafe tool will adjust player input to get a different kind of strafing depending on parameters.\n\n**Example:** ```strafe 299.999ups left veccam```",
            index: 14,
        },
        decel: {
            bulkType: BulkType.Movement,
            hasFixedOrder: true,
            hasOff: true,
            activeUsageType: ActiveUsageType.Manual,
            arguments: [
                { type: TokenType.Number, unit: "ups?", required: false },
            ],
            expectsArguments: true,
            allowArbitraryArguments: false,
            description: "**Syntax:** ```decel <speed>```\n\nThe decelaration tool will slow down as quickly as possible to the given speed.\n\n**Example:** ```decel 100```",
            index: 15,
        }
    };
}
