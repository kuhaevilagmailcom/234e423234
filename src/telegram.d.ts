export {};

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe?: {
          user?: { id: number; first_name: string; last_name?: string; username?: string; photo_url?: string };
          receiver?: { id: number; first_name: string; last_name?: string; username?: string; photo_url?: string };
          start_param?: string;
        };
        ready: () => void;
        expand: () => void;
        close?: () => void;
        openTelegramLink?: (url: string) => void;
        BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick?: (cb: () => void) => void };
        HapticFeedback?: { impactOccurred: (style: string) => void; notificationOccurred: (type: string) => void };
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
      };
    };
  }
}
