import { MarkupContent, MarkupKind } from "vscode-languageserver/node";

export namespace TASTool {
    export function getToolArgument(toolName: string, arg: string): ToolArgument | undefined {
        return tools[toolName].arguments.find((toolArg) => !toolArg.matcher ? toolArg.name === arg : toolArg.matcher.test(arg));
    }

    export function getToolDescription(toolName: string): MarkupContent {
        return {
            kind: MarkupKind.Markdown,
            value: TASTool.tools[toolName].description || ""
        };
    }

    export function getArgumentDescription(toolName: string, arg: string): MarkupContent {
        const value = getToolArgument(toolName, arg)?.description || "";

        return {
            kind: MarkupKind.Markdown,
            value: value
        };
    }

    export class Tool {
        tool: string;
        startTick?: number;
        totalTicks?: number;
        ticksRemaining?: number;

        constructor(tool: string, startTick?: number, ticks?: number) {
            this.tool = tool;
            this.startTick = startTick;
            this.totalTicks = ticks;
            this.ticksRemaining = ticks;
        }

        copy(): Tool {
            return new Tool(this.tool, this.startTick, this.ticksRemaining);
        }
    }

    export enum ToolArgumentType {
        On, Off, Setting, Digit, Unit
    }

    interface ToolDefinitions {
        [key: string]: {
            arguments: ToolArgument[],
            requiredArgumentsCount: number,
            durationPos?: number, // The position of the duration argument
            description?: string,
        };
    }

    export class ToolArgument {
        readonly name: string;
        readonly type: ToolArgumentType;
        readonly matcher?: RegExp;
        readonly unit?: string;
        readonly description?: string;

        constructor(name: string, type: ToolArgumentType, matcher?: RegExp, unit?: string) {
            this.name = name;
            this.type = type;
            this.matcher = matcher;
            this.unit = unit;
        }
    }

    export const tools: ToolDefinitions = {
        strafe: {
            arguments: [
                { name: "off", type: ToolArgumentType.Off, matcher: /none|off$/, description: "Disables strafing entirely." },
                { name: "vec", type: ToolArgumentType.Setting, description: "Enables vectorial strafing (movement analog is adjusted to get desired movement direction). (default)" },
                { name: "ang", type: ToolArgumentType.Setting, description: "Enables angular strafing (view analog is adjusted to get desired movement direction). This isn't particularly recommended as it doesn't look appealing, however it is the only effective strafing type while on velocity gel." },
                { name: "veccam", type: ToolArgumentType.Setting, description: "Enables special vectorial strafing that rotates you towards your current moving direction." },
                { name: "max", type: ToolArgumentType.Setting, description: "Makes autostrafer aim for the greatest acceleration. (default)" },
                { name: "keep", type: ToolArgumentType.Setting, description: "Makes autostrafer maintain the current velocity." },
                { name: "speed", type: ToolArgumentType.Unit, matcher: /\d+ups$/, unit: "ups", description: "Sets a target velocity of [number] units per second for the autostrafer." },
                { name: "forward", type: ToolArgumentType.Setting, description: "Autostrafer will try to strafe in a straight line, towards the current view angle. (default)" },
                { name: "forwardvel", type: ToolArgumentType.Setting, description: "Autostrafer will try to strafe in a straight line, towards the current velocity angle." },
                { name: "left", type: ToolArgumentType.Setting, description: "Autostrafer will try to strafe left." },
                { name: "right", type: ToolArgumentType.Setting, description: "Autostrafer will try to strafe right." },
                { name: "degrees", type: ToolArgumentType.Unit, matcher: /\d+deg$/, unit: "deg", description: "Sets a target yaw angle of [number] degrees autostrafer should strafe towards." },
                { name: "nopitchlock", type: ToolArgumentType.Setting, description: "Make the autostrafer not clamp the pitch. The autostrafer will always clamp your pitch angle (up and down) between -30 and 30 when midair, as it gives the fastest possible acceleration (forward movement is being scaled by a cosine of that angle while being airborne). This argument will tell the autostrafer that you wish to enable sub-optimal strafing (this is useful when you need to hit a shot while strafing for example)." },
            ],
            requiredArgumentsCount: 1,
            description: "**Syntax:** ```strafe [parameters]```\n\nThe strafe tool will adjust player input to get a different kind of strafing depending on parameters.\n\n**Example:** ```strafe 299.999ups left veccam```"
        },
        autojump: {
            arguments: [
                { name: "on", type: ToolArgumentType.On, description: "Enables ```autojump```." },
                { name: "off", type: ToolArgumentType.Off, matcher: /^(?!on).*$/, description: "Disables ```autojump```." }
            ],
            requiredArgumentsCount: 1,
            description: "**Syntax:** ```autojump [on]```\n\nAnything other than ```on``` will disable the tool.\n\nAutojump tool will change the jump button state depending on whether the player is grounded or not, resulting in automatically jumping on the earliest contact with a ground.\n\n**Example:** ```autojump on```"
        },
        absmov: {
            arguments: [
                { name: "digit", type: ToolArgumentType.Digit, matcher: /\d+(\.\d+)?$/ },
                { name: "off", type: ToolArgumentType.Off, description: "Disables ```absmov```." },
            ],
            requiredArgumentsCount: 1,
            description: "**Syntax:** ```absmov <angle> [strength]```\n\nAbsolute movement tool will generate movement values depending on the absolute move direction you provide in degrees. Giving off as an argument will disable the tool. The strength parameter must be between 0 and 1 (default) and controls how fast the player will move.\n\n**Example:** ```absmov 90 0.5```"
        },
        setang: {
            arguments: [
                { name: "digit", type: ToolArgumentType.Digit, matcher: /\d(\.\d+)?$/ },
            ],
            requiredArgumentsCount: 2,
            durationPos: 3,
            description: "**Syntax:** ```setang <pitch> <yaw> [time]```\n\nThis tool works basically the same as setang console command. It will adjust the view analog in a way so the camera is looking towards given angles.\n\n**Example:** ```setang 0 0 20```"
        },
        autoaim: {
            arguments: [
                { name: "digit", type: ToolArgumentType.Digit, matcher: /\d+(\.\d+)?$/ },
                { name: "off", type: ToolArgumentType.Off, description: "Disables ```autoaim```" },
            ],
            requiredArgumentsCount: 3,
            durationPos: 4,
            description: "**Syntax:** ```autoaim <x> <y> <z> [time]```\n\nThe Auto Aim tool will automatically aim towards a specified point in 3D space.\n\n**Example:** ```autoaim 0 0 0 20```"
        },
        decel: {
            arguments: [
                { name: "digit", type: ToolArgumentType.Digit, matcher: /\d+(\.\d+)?$/ },
                { name: "off", type: ToolArgumentType.Off, description: "Disables ```decel```" },
            ],
            requiredArgumentsCount: 1,
            description: "**Syntax:** ```decel <speed>```\n\nThe decelaration tool will slow down as quickly as possible to the given speed.\n\n**Example:** ```decel 100```"
        }
    };
}