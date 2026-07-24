import { Suspense } from "react";
import { TeamSwitcher, useUser } from "@hexclave/react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@versionless/ui/components/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@versionless/ui/components/sidebar";
import {
  Activity,
  BookOpen,
  ChartBar,
  Clock,
  GitBranch,
  House,
  KeyRound,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  RadioTower,
  Settings,
  Sun,
  SunMoon,
  UserRound,
} from "lucide-react";

import {
  getInsightsProjectId,
  preserveInsightsSearch,
} from "@/components/insights/insights-navigation";
import { docsHref } from "@/components/docs-link";
import { useTheme } from "@/components/theme-provider";
import { hexclaveClientApp } from "@/hexclave/client";

type CurrentUser = NonNullable<ReturnType<typeof useUser>>;

const projectLinks = [
  {
    to: "/insights/$projectId",
    label: "Overview",
    icon: ChartBar,
  },
  {
    to: "/insights/$projectId/sunset",
    label: "Can I sunset?",
    icon: Clock,
  },
  {
    to: "/insights/$projectId/drift",
    label: "Transform depth",
    icon: GitBranch,
  },
  {
    to: "/insights/$projectId/traces",
    label: "Traces",
    icon: Activity,
  },
  {
    to: "/insights/$projectId/telemetry",
    label: "Telemetry",
    icon: RadioTower,
  },
] as const;

function TeamMenu({ user }: { user: CurrentUser }) {
  const teams = user.useTeams();
  const selectedTeam = user.selectedTeam ?? teams[0] ?? undefined;

  return (
    <TeamSwitcher
      team={selectedTeam}
      teams={teams}
      triggerClassName="h-8 w-full max-w-none"
      onChange={(team) => user.setSelectedTeam(team)}
    />
  );
}

function HeaderTeamSwitcher() {
  const user = useUser();
  if (!user) return null;

  return <TeamMenu user={user} />;
}

function SettingsMenu() {
  const user = useUser();
  const { setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<SidebarMenuButton tooltip="Settings" />}
      >
        <Settings />
        <span>Settings</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        className="min-w-48"
      >
        {user ? (
          <DropdownMenuItem
            onClick={() => void hexclaveClientApp.redirectToAccountSettings()}
          >
            <UserRound />
            Account settings
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onClick={() => void hexclaveClientApp.redirectToSignIn()}
          >
            <LogIn />
            Sign in
          </DropdownMenuItem>
        )}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SunMoon />
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={() => setTheme("light")}>
              <Sun />
              Light
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")}>
              <Moon />
              Dark
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")}>
              <Monitor />
              System
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {user ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => void user.signOut()}
            >
              <LogOut />
              Log out
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function Header() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const links = [
    { to: "/", label: "Home", icon: House },
    { to: "/keys", label: "API keys", icon: KeyRound },
  ] as const;
  const projectId = getInsightsProjectId(pathname);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-3 group-data-[collapsible=icon]:p-2">
        <div className="flex h-8 items-center gap-2">
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <Suspense fallback={null}>
              <HeaderTeamSwitcher />
            </Suspense>
          </div>
          <SidebarTrigger className="shrink-0 group-data-[collapsible=icon]:mx-auto" />
        </div>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <SidebarGroup className="pt-3">
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {links.map(({ to, label, icon: Icon }) => {
                const isActive =
                  to === "/" ? pathname === "/" : pathname.startsWith(to);

                return (
                  <SidebarMenuItem key={to}>
                    <SidebarMenuButton
                      render={<Link to={to} />}
                      isActive={isActive}
                      tooltip={label}
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {projectId ? (
          <SidebarGroup>
            <SidebarGroupLabel>Project insights</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {projectLinks.map(({ to, label, icon: Icon }) => {
                  const href = to.replace("$projectId", projectId);

                  return (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton
                        render={
                          <Link
                            to={to}
                            params={{ projectId }}
                            search={preserveInsightsSearch}
                          />
                        }
                        isActive={pathname === href}
                        tooltip={label}
                      >
                        <Icon />
                        <span>{label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<a href={docsHref(import.meta.env.DEV)} />}
              tooltip="Docs"
            >
              <BookOpen />
              <span>Docs</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <Suspense fallback={null}>
              <SettingsMenu />
            </Suspense>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
