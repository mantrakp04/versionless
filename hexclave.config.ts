import { defineHexclaveConfig } from "@hexclave/js/config";

export const config = defineHexclaveConfig({
  apps: {
    installed: {
      authentication: { enabled: true },
      teams: { enabled: true },
      rbac: { enabled: true },
      "api-keys": { enabled: true },
    },
  },
  auth: {
    allowSignUp: true,
    oauth: {
      accountMergeStrategy: "link_method",
      providers: {
        google: {
          type: "google",
          allowSignIn: true,
          allowConnectedAccounts: true,
        },
        github: {
          type: "github",
          allowSignIn: true,
          allowConnectedAccounts: true,
        },
      },
    },
  },
  teams: {
    createPersonalTeamOnSignUp: true,
    allowClientTeamCreation: true,
  },
  apiKeys: {
    enabled: {
      team: true,
      user: false,
    },
  },
  rbac: {
    permissions: {
      member: {
        description: "Standard team member access",
        scope: "team",
        containedPermissionIds: {
          $read_members: true,
        },
      },
      admin: {
        description: "Full team management access",
        scope: "team",
        containedPermissionIds: {
          member: true,
          $invite_members: true,
          $remove_members: true,
          $update_team: true,
          $delete_team: true,
          $manage_api_keys: true,
        },
      },
    },
    defaultPermissions: {
      teamCreator: {
        admin: true,
      },
      teamMember: {
        member: true,
      },
    },
  },
});
