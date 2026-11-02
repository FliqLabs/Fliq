import { create } from "zustand";

type WaitlistState = {
  email: string;
  setEmail: (email: string) => void;
  clearEmail: () => void;
};

export const useWaitlistStore = create<WaitlistState>((set) => ({
  email: "",
  setEmail: (email) => set({ email }),
  clearEmail: () => set({ email: "" }),
}));
