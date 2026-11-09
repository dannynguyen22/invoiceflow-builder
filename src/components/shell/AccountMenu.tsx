import { useState } from "react";
import { Cloud, LogIn, LogOut } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/cloud/auth";
import { useUploads } from "@/extraction/useUploads";
import { useI18n } from "@/i18n";

/** Optional Google sign-in. Guests keep every feature; signing in only adds template sync. */
export function AccountMenu() {
  const { t } = useI18n();
  const { status, user, signIn, signOut } = useAuth();
  const uploaded = useUploads().length > 0;
  const [confirmReload, setConfirmReload] = useState(false);
  const [open, setOpen] = useState(false);

  const start = async () => {
    try {
      await signIn();
    } catch {
      toast.error(t("auth.signInFailed"));
    }
  };
  // The OAuth redirect reloads the page; invoices live only in memory, so ask first.
  const onSignIn = () => (uploaded ? setConfirmReload(true) : void start());

  if (status === "signed_in" && user) {
    const initial = (user.name || user.email || "?").trim().charAt(0).toUpperCase();
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-2 px-2"
            aria-label={`${t("auth.menuLabel")}: ${user.email}`}
          >
            <span
              aria-hidden
              className="flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
            >
              {initial}
            </span>
            <span className="hidden max-w-[10rem] truncate text-xs lg:inline">{user.name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="space-y-0.5 font-normal">
            <span className="block text-[11px] text-muted-foreground">{t("auth.signedInAs")}</span>
            <span className="block truncate text-sm font-medium" title={user.email}>
              {user.email}
            </span>
          </DropdownMenuLabel>
          <p className="flex items-start gap-1.5 px-2 pb-1.5 text-[11px] text-muted-foreground">
            <Cloud className="mt-px size-3 shrink-0" aria-hidden /> {t("auth.syncNote")}
          </p>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              void signOut().then(() => toast(t("auth.signedOut")));
            }}
          >
            <LogOut aria-hidden /> {t("auth.signOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const unavailable = status === "disabled";
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-[13px]">
            <LogIn aria-hidden /> {t("auth.signIn")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-2 p-3 text-sm">
          <h2 className="font-medium">
            {unavailable ? t("auth.unavailableTitle") : t("auth.guestTitle")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {unavailable ? t("auth.unavailableBody") : t("auth.guestBody")}
          </p>
          {!unavailable && (
            <Button
              size="sm"
              className="w-full"
              disabled={status === "loading"}
              onClick={() => {
                setOpen(false);
                onSignIn();
              }}
            >
              {t("auth.signInGoogle")}
            </Button>
          )}
        </PopoverContent>
      </Popover>
      <AlertDialog open={confirmReload} onOpenChange={setConfirmReload}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("auth.reloadTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("auth.reloadBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("auth.reloadCancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void start()}>
              {t("auth.reloadConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
