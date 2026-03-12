import React, { ReactNode, Ref, useCallback, useMemo, useRef } from "react";
import { DialogForItem } from "./useDialogForItem";
import { TextWithIcon } from "../components/text-with-icon";
import { ContextMenuItem } from "../components/context-menu";

type TitleKeyPart =
  | { title: string; key?: undefined }
  | { title: ReactNode; key: string };

type BaseProps<TItem> = {
  ref: Ref<DialogForItem<TItem>>;
};

export type DialogsInputTuple<T extends readonly object[], TItem> = {
  [K in keyof T]: {
    component: (
      props: T[K] & BaseProps<TItem>,
    ) => React.JSX.Element | undefined | null;
    props: Omit<NoInfer<T[K]>, "ref">;
    active?: (item: TItem) => boolean;
    icon?: React.ComponentType<{ className?: string }>;
  } & TitleKeyPart;
};

export type DialogsReturn<TItem> = ReturnType<typeof useDialogs<any, TItem>>;

export function useDialogs<T extends readonly object[], TItem>(
  ...dialogs: readonly [...DialogsInputTuple<T, TItem>]
) {
  type Dialog = (typeof dialogs)[number];
  type Component = Dialog["component"];
  const map = useRef(new Map<Component, DialogForItem<TItem> | null>());

  const cb = useCallback(
    (ref: DialogForItem<TItem> | null, component: Component) => {
      map.current.set(component, ref);
    },
    [],
  );

  const currentRef = useRef<{ component: Component; item: TItem } | null>(null);

  const getKey = (d: (typeof dialogs)[number]) => d.key ?? d.title;

  return useMemo(() => {
    return {
      RenderOutside: (
        <>
          {dialogs.map((d) => (
            <d.component
              key={getKey(d)}
              ref={(ref) => cb(ref, d.component)}
              {...d.props}
            />
          ))}
        </>
      ),
      count: dialogs.length,
      show: (dialog: Dialog, item: TItem) => {
        map.current.get(dialog.component)!.show({
          item,
        });
        currentRef.current = { component: dialog.component, item };
      },

      isActive: (d: Dialog, item: TItem) => !d.active || d.active(item),
      getKey,
      dialogs,
      currentRef: currentRef,
    };
  }, [cb, map, dialogs, currentRef]);
}

export function renderAsContextMenu<T extends readonly object[], TItem>(
  item: TItem,
  dialogs: ReturnType<typeof useDialogs<T, TItem>>,
) {
  return dialogs.dialogs
    .filter((d) => !d.active || d.active(item))
    .map((d) => {
      const contextMenuItem: ContextMenuItem = {
        onClick: () => dialogs.show(d, item),
        view: (
          <TextWithIcon key={dialogs.getKey(d)} icon={d.icon}>
            {d.title}
          </TextWithIcon>
        ),
      };
      return contextMenuItem;
    });
}
