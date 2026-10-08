import { useEffect, useRef } from 'react';

// Keep non-native dialogs keyboard-contained, including while their actions change.
export function useModalFocus<T extends HTMLElement = HTMLDivElement>(open: boolean, onClose: () => void, busy = false) {
  const dialog = useRef<T>(null);
  const current = useRef({ onClose, busy });
  current.current = { onClose, busy };
  useEffect(() => {
    if (!open || !dialog.current) return;
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    const controls = () => Array.from(element.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]'))
      .filter(item => item.tabIndex >= 0 && !item.matches(':disabled,[hidden]') && !item.closest('[hidden],[inert]'));
    const focusFirst = () => (controls()[0] || element).focus();
    const keydown = (event: KeyboardEvent) => {
      // Nested native confirmation dialogs own their keyboard interaction.
      if (event.target instanceof Element && event.target.closest('dialog[open]')) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (!current.current.busy) current.current.onClose();
      }
      if (event.key === 'Tab') {
        const items = controls(), first = items[0], last = items[items.length - 1];
        if (!first) { event.preventDefault(); element.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === element)) { event.preventDefault(); first.focus(); }
      }
    };
    const contain = (event: FocusEvent) => { if (!element.contains(event.target as Node)) focusFirst(); };
    focusFirst();
    document.addEventListener('keydown', keydown);
    document.addEventListener('focusin', contain);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('focusin', contain);
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  return dialog;
}
