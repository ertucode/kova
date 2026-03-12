import { ReactNode } from "react";
import { Dialog } from "@/lib/components/dialog";
import { createStore } from "@xstate/store";
import { useSelector } from "@xstate/store/react";

type ConfirmationOptions = {
  title: string;
  message: ReactNode;
  onConfirm: () => void | Promise<void>;
  onReject?: () => void;
  confirmText?: string;
  rejectText?: string;
};

export const confirmation = createStore({
  context: {
    confirmation: null,
    isOpen: false,
  } as { confirmation: ConfirmationOptions | null; isOpen: boolean },
  on: {
    confirm: (_, event: ConfirmationOptions) => ({
      confirmation: event,
      isOpen: true,
    }),
    hide: (_) => ({
      confirmation: null,
      isOpen: false,
    }),
  },
});

export function ConfirmationRenderer() {
  const { confirmation: state } = useSelector(confirmation, (v) => v.context);

  const handleConfirm = async () => {
    if (!state) return;
    await state.onConfirm();
    confirmation.trigger.hide();
  };

  const handleReject = () => {
    if (!state) return;

    state.onReject?.();
    confirmation.trigger.hide();
  };

  return (
    <>
      {state && (
        <Dialog onClose={handleReject} className="max-w-[60vw]">
          <h3 className="font-bold text-lg mb-4">{state.title}</h3>
          <div className="mb-4">{state.message}</div>
          <div className="modal-action">
            <button
              className="btn btn-primary"
              autoFocus
              onClick={handleConfirm}
            >
              {state.confirmText || "Confirm"}
            </button>
            <button className="btn" onClick={handleReject}>
              {state.rejectText || "Cancel"}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
