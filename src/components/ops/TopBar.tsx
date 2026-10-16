import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDirectory, useMe } from "@/lib/queries";
import { setCurrentUserId } from "@/lib/session";
import type { Role } from "@/api/types";
import { Avatar } from "./bits";
import { CreateItemDialog } from "./CreateItemDialog";

const rank: Role[] = ["admin", "manager", "member", "viewer"];

export function topRole(roles: (Role | null)[]): Role {
  return rank.find((r) => roles.includes(r)) ?? "viewer";
}

export function TopBar() {
  const dir = useDirectory();
  const me = useMe();
  const qc = useQueryClient();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("opsdesk.theme", next ? "dark" : "light");
  };

  const roleOf = (uid: string) => topRole(dir.memberships.filter((m) => m.userId === uid).map((m) => m.role));

  const linkCls = "rounded px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground";
  return (
    <header className="sticky top-0 z-20 flex h-12 items-center gap-4 border-b bg-background/90 px-4 backdrop-blur">
      <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
        <span className="grid size-5 place-items-center rounded bg-primary font-mono text-[10px] text-primary-foreground">OD</span>
        OpsDesk
      </Link>
      <nav className="flex items-center gap-1">
        <Link to="/" className={linkCls} activeProps={{ className: "bg-accent text-foreground" }} activeOptions={{ exact: true }}>
          Needs attention
        </Link>
        <Link to="/items" className={linkCls} activeProps={{ className: "bg-accent text-foreground" }}>
          All items
        </Link>
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <CreateItemDialog />
        <Button variant="ghost" size="icon" className="size-8" onClick={toggleTheme} aria-label="Toggle theme">
          {dark ? <Sun /> : <Moon />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Avatar user={me.user} />
              <span>{me.user.name}</span>
              <span className="text-xs capitalize text-muted-foreground">{roleOf(me.user.id)}</span>
              <ChevronsUpDown className="opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Switch user</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {dir.users.map((u) => (
              <DropdownMenuItem
                key={u.id}
                onSelect={() => {
                  setCurrentUserId(u.id);
                  qc.invalidateQueries();
                }}
              >
                <Avatar user={u} />
                <span className="flex-1">{u.name}</span>
                <span className="text-xs capitalize text-muted-foreground">{roleOf(u.id)}</span>
                {u.id === me.user.id && <Check className="size-3.5" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
