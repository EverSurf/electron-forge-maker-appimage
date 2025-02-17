import MakerBase, { MakerOptions } from "@electron-forge/maker-base";
import {
  ForgePlatform,
  IForgeResolvableMaker,
  IForgeMaker,
} from "@electron-forge/shared-types";
import path from "path";
import * as appBuilder from "app-builder-lib/out/util/appBuilder";

import { MakerAppImageConfig } from "./Config";
import { mkdirSync, existsSync, rmdirSync } from "fs";
import { exec } from "child_process";

const makerPackageName = "electron-forge-maker-appimage";

interface AppImageForgeConfig {
  template?: string;
  chmodChromeSandbox?: string;
}

const isIForgeResolvableMaker = (
  maker: IForgeResolvableMaker | IForgeMaker
): maker is IForgeResolvableMaker => {
  return maker.hasOwnProperty("name");
};

export default class MakerAppImage extends MakerBase<MakerAppImageConfig> {
  name = "AppImage";

  defaultPlatforms: ForgePlatform[] = ["linux"];

  isSupportedOnCurrentPlatform() {
    return process.platform === "linux" || process.platform === "darwin";
  }

  async make({
    dir, // '/home/build/Software/monorepo/packages/electron/out/name-linux-x64'
    appName, // 'name'
    makeDir, // '/home/build/Software/monorepo/packages/electron/out/make',
    targetArch, // 'x64'
    packageJSON,
    targetPlatform, //'linux',
    forgeConfig,
  }: MakerOptions) {
    const executableName = forgeConfig.packagerConfig.executableName || appName;

    // Check for any optional configuration data passed in from forge config, specific to this maker.
    let config: (AppImageForgeConfig & MakerAppImageConfig) | undefined;

    const maker = forgeConfig.makers.find(
      (maker) =>
        isIForgeResolvableMaker(maker) && maker.name === makerPackageName
    );

    if (maker !== undefined && isIForgeResolvableMaker(maker)) {
      config = maker.config;
    }

    const appFileName = `${appName}-${packageJSON.version}-${targetArch}.AppImage`;
    const appPath = path.join(makeDir, appFileName);

    // construct the desktop file.
    const desktopMeta: { [parameter: string]: string } = {
      Name: appName,
      Exec: executableName,
      Terminal: "false",
      Type: "Application",
      Icon: executableName,
      StartupWMClass: packageJSON.productName as string,
      "X-AppImage-Version": packageJSON.version,
      Comment: packageJSON.description,
      Categories: "Utility",
    };

    let desktopEntry = `[Desktop Entry]`;
    for (const name of Object.keys(desktopMeta)) {
      desktopEntry += `\n${name}=${desktopMeta[name]}`;
    }
    desktopEntry += "\n";

    // These icons will be presented in .AppImage file thumbnail
    let icons: {
      [index: number]: { file: string; size: number };
    };
    if (config?.options !== undefined && config.options.icon !== undefined) {
      icons = [{ file: path.join(dir, "../..", config.options.icon), size: 0 }];
    } else {
      // default Electron icons when "config.icon" isn't definied:const iconPath = path.join(
      const iconPath = path.join(
        dir,
        "../..",
        "node_modules/app-builder-lib/templates/icons/electron-linux"
      );
      icons = [
        { file: `${iconPath}/16x16.png`, size: 16 },
        { file: `${iconPath}/32x32.png`, size: 32 },
        { file: `${iconPath}/48x48.png`, size: 48 },
        { file: `${iconPath}/64x64.png`, size: 64 },
        { file: `${iconPath}/128x128.png`, size: 128 },
        { file: `${iconPath}/256x256.png`, size: 256 },
      ];
    }

    const stageDir = path.join(makeDir, "__appImage-x64");

    if (!existsSync(makeDir)) {
      mkdirSync(makeDir, { recursive: true });
    }

    if (existsSync(stageDir)) {
      rmdirSync(stageDir);
    }
    mkdirSync(stageDir, { recursive: true });

    // if the user passed us a chmodChromeSandbox parameter, use that to modify the permissions of chrome-sandbox.
    // this sets up the ability to run the application conditionally with --no-sandbox on select systems.
    if (config !== undefined && config.chmodChromeSandbox !== undefined) {
      await exec(
        `chmod ${config.chmodChromeSandbox} ${path.join(dir, "chrome-sandbox")}`
      );
    }

    const appImageOptions = config?.options?.mimeType?.length
      ? {
          fileAssociations: [
            {
              ext: "AppImage",
              mimeType: config.options.mimeType[0], // pick the first one
            },
          ],
          ...(config.options.mimeType.length > 1
            ? {
                mimeTypes: config.options.mimeType.slice(1), // add the rest
              }
            : {}),
        }
      : { fileAssociations: [] };

    const args = [
      "appimage",
      "--stage", // '/home/build/Software/monorepo/packages/electron/out/make/__appImage-x64',
      stageDir,
      "--arch", // 'x64'
      "x64",
      "--output", // '/home/build/Software/monorepo/packages/electron/out/make/name-2.0.6.AppImage',
      appPath,
      "--app", // '/home/build/Software/monorepo/packages/electron/out/name-linux-x64',
      dir,
      "--configuration",
      JSON.stringify({
        productName: appName,
        productFilename: appName,
        desktopEntry: desktopEntry,
        executableName: executableName,
        icons: icons,
        ...appImageOptions,
      }),
    ];

    // the --template option allows us to replace AppRun bash script with a custom version, e.g. a libstdc++ bootstrapper.
    if (config !== undefined && config.template) {
      args.push("--template");
      args.push(config.template);
    }

    const result = await appBuilder.executeAppBuilderAsJson(args);

    return [appPath];
  }
}
