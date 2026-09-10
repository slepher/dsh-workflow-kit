import type { KeyboardEvent, RefObject } from 'react';
import type { Action, Skill } from './types.js';
export declare const commands: readonly [readonly ["model", "选择模型和推理等级"], readonly ["skills", "打开技能列表"], readonly ["status", "查看当前会话状态"], readonly ["new", "打开空白对话"], readonly ["compact", "压缩当前对话上下文"], readonly ["review", "审查未提交的改动"], readonly ["copy", "复制最近的回答"]];
export declare function useInputMenu({ text, setText, input, sessionId, workerId, call, command }: {
    text: string;
    setText: (text: string) => void;
    input: RefObject<HTMLTextAreaElement>;
    sessionId: string;
    workerId?: string;
    call: (sessionId: string, input: Action) => Promise<unknown>;
    command: (name: string) => Promise<void>;
}): {
    onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean;
    setCaret: import("react").Dispatch<import("react").SetStateAction<number>>;
    selected: Skill[];
    clear: () => void;
    aria: {
        'aria-autocomplete': "list";
        'aria-expanded': boolean;
        'aria-controls': string | undefined;
        'aria-activedescendant': string | undefined;
    };
    menu: false | import("react").JSX.Element;
};
//# sourceMappingURL=input-menu.d.ts.map