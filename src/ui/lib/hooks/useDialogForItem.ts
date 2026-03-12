import { Ref, useImperativeHandle, useState } from "react";

export type DialogForItem<T> = {
  show: (item: { item: T }) => void;
};
export function useDialogForItem<TItem>(
  ref: Ref<DialogForItem<TItem>> | undefined,
) {
  const [item, setItem] = useState<TItem | undefined>(undefined);
  useImperativeHandle(ref, () => ({
    show: (props) => {
      setDialogOpen(true);
      setItem(props.item);
    },
  }));

  const [dialogOpen, setDialogOpen] = useState(false);

  return {
    item,
    setItem,
    dialogOpen,
    setDialogOpen,
  };
}
