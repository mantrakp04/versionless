import { defineHexclaveConfig } from "@hexclave/js/config";

export const config = defineHexclaveConfig({
  apps: {
    installed: {
      rbac: { enabled: true },
      teams: { enabled: true },
      "api-keys": { enabled: true },
      authentication: { enabled: true },
      analytics: { enabled: true },
      gtm: { enabled: true },
    },
  },
  auth: {
    oauth: {
      providers: {
        github: {
          type: "github",
          allowSignIn: true,
          allowConnectedAccounts: true,
        },
        google: {
          type: "google",
          allowSignIn: true,
          allowConnectedAccounts: true,
        },
      },
      accountMergeStrategy: "link_method",
    },
    allowSignUp: true,
  },
  teams: {
    allowClientTeamCreation: true,
    createPersonalTeamOnSignUp: true,
  },
  apiKeys: {
    enabled: {
      team: true,
      user: false,
    },
  },
  rbac: {
    permissions: {
      admin: {
        scope: "team",
        description: "Full team management access",
        containedPermissionIds: {
          member: true,
          $delete_team: true,
          $update_team: true,
          $invite_members: true,
          $remove_members: true,
          $manage_api_keys: true,
        },
      },
      member: {
        scope: "team",
        description: "Standard team member access",
        containedPermissionIds: {
          $read_members: true,
        },
      },
    },
    defaultPermissions: {
      teamMember: {
        member: true,
      },
      teamCreator: {
        admin: true,
      },
    },
  },
});
