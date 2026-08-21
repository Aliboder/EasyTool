import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  placeholder?: string;
  defaultValue?: string;
  onConfirm: (value: string) => void;
  onCancel?: () => void;
}

export function PromptDialog({
  open,
  onOpenChange,
  title,
  placeholder,
  defaultValue = "",
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
    }
  }, [open, defaultValue]);

  const handleConfirm = () => {
    onConfirm(value);
    onOpenChange(false);
  };

  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleConfirm();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[320px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            取消
          </Button>
          <Button onClick={handleConfirm}>确定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Hook 版本，方便使用
export function usePrompt() {
  const [state, setState] = useState<{
    open: boolean;
    title: string;
    placeholder?: string;
    defaultValue?: string;
    resolve?: (value: string | null) => void;
  }>({
    open: false,
    title: "",
  });

  const prompt = (
    title: string,
    options?: { placeholder?: string; defaultValue?: string }
  ): Promise<string | null> => {
    return new Promise((resolve) => {
      setState({
        open: true,
        title,
        placeholder: options?.placeholder,
        defaultValue: options?.defaultValue,
        resolve,
      });
    });
  };

  const handleConfirm = (value: string) => {
    state.resolve?.(value);
    setState((prev) => ({ ...prev, open: false }));
  };

  const handleCancel = () => {
    state.resolve?.(null);
    setState((prev) => ({ ...prev, open: false }));
  };

  return {
    prompt,
    PromptDialog: (
      <PromptDialog
        open={state.open}
        onOpenChange={(open) => {
          if (!open) handleCancel();
        }}
        title={state.title}
        placeholder={state.placeholder}
        defaultValue={state.defaultValue}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    ),
  };
}