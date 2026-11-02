import { createApp } from "vue";
import App from "./App.vue";
// 拉丁字符与数字用 IBM Plex Sans Condensed（只打包 latin 子集的三个字重），中文回落到系统字体
import "@fontsource/ibm-plex-sans-condensed/latin-400.css";
import "@fontsource/ibm-plex-sans-condensed/latin-500.css";
import "@fontsource/ibm-plex-sans-condensed/latin-600.css";
import "./styles/globals.css";

createApp(App).mount("#app");
