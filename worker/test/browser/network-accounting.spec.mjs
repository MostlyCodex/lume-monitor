import {expect,test} from "@playwright/test";
import {startPreviewServer} from "../dashboard-preview-server.mjs";
let server,origin;
test.beforeAll(async()=>{server=await startPreviewServer(0);origin=`http://127.0.0.1:${server.address().port}`;});
test.afterAll(async()=>{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));});

async function setHidden(page,hidden) {
 await page.evaluate(value=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>value});document.dispatchEvent(new Event("visibilitychange"));},hidden);
}
test("hidden dashboard pauses polling and resumes without duplicate requests or reviving expired authentication",async({page})=>{
 await page.clock.install();
 let requests=0,expired=false;
 page.on("request",request=>{if(request.url().includes("/api/v1/dashboard/"))requests++;});
 await page.route("**/api/v1/dashboard/latest",route=>expired ? route.fulfill({status:401,json:{error:"unauthorized"}}) : route.continue());
 await page.goto(`${origin}/dashboard/`,{waitUntil:"networkidle"});
 await page.locator(".node-card").first().click();
 await expect(page.locator("#detail-content")).toBeVisible();
 await page.waitForLoadState("networkidle");
 await setHidden(page,true);const paused=requests;
 await page.clock.fastForward(6*60_000);expect(requests).toBe(paused);
 const latest=page.waitForResponse(response=>response.url().endsWith("/dashboard/latest"));
 await setHidden(page,false);await latest;
 await page.waitForLoadState("networkidle");expect(requests-paused).toBe(3);
 const fresh=requests;
 await setHidden(page,true);
 await page.clock.fastForward(1000);
 const refresh=page.waitForResponse(response=>response.url().endsWith("/dashboard/latest"));
 await setHidden(page,false);await refresh;
 await page.waitForLoadState("networkidle");expect(requests-fresh).toBe(1);
 expired=true;
 await setHidden(page,true);await setHidden(page,false);
 await expect(page.locator("#auth-view")).toBeVisible();const signedOut=requests;
 await setHidden(page,true);await setHidden(page,false);await page.clock.fastForward(6*60_000);
 expect(requests).toBe(signedOut);
});

test("cycle totals reuse the traffic row and explain the selected interfaces and observed period",async({page},testInfo)=>{
 await page.route("**/api/v1/dashboard/latest",async route=>{
  const response=await route.fetch();const data=await response.json();const node=data.nodes[0];
  Object.assign(node.metrics,{network_valid:true,network_interfaces:["eth0","ens192"],traffic_cycle:{reset_day:1,time_zone:"Asia/Shanghai",period_start:1785513600,period_end:1788192000,observed_since:1786000000,rx_bytes:1073741824,tx_bytes:2147483648,partial:true}});
  await route.fulfill({response,json:data});
 });
 await page.goto(`${origin}/dashboard/`,{waitUntil:"networkidle"});
 const card=page.locator(".node-card").first();
 await expect(card.locator(".node-network-row")).toHaveCount(2);
 await expect(card).toContainText("周期流量（估算）");
 await card.click();
 const facts=page.locator("#detail-facts");await expect(facts).toContainText("eth0、ens192");await expect(facts).toContainText("监测覆盖不完整");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 const overflow=await facts.locator("dd").evaluateAll(values=>values.some(value=>value.scrollWidth>value.clientWidth+1));expect(overflow).toBe(false);
 await testInfo.attach("traffic-cycle-facts",{body:await facts.screenshot(),contentType:"image/png"});
});

test("unavailable interface measurements remain unknown instead of displaying zero traffic",async({page})=>{
 await page.route("**/api/v1/dashboard/latest",async route=>{
  const response=await route.fetch();const data=await response.json();Object.assign(data.nodes[0].metrics,{network_valid:false,network_interfaces:[],network_rx_bytes:null,network_tx_bytes:null,network_rx_rate_bps:null,network_tx_rate_bps:null});await route.fulfill({response,json:data});
 });
 await page.goto(`${origin}/dashboard/`,{waitUntil:"networkidle"});const card=page.locator(".node-card").first();
 await expect(card.locator(".node-network-row").nth(1)).toContainText("↑ —");await card.click();await expect(page.locator("#detail-facts")).toContainText("无法识别，请配置网卡");
});

test("enabled accounting without a valid period never falls back to system totals",async({page})=>{
 await page.route("**/api/v1/dashboard/latest",async route=>{
  const response=await route.fetch();const data=await response.json();Object.assign(data.nodes[0].metrics,{network_valid:true,network_interfaces:["eth0"],traffic_cycle_enabled:true,traffic_cycle:null});await route.fulfill({response,json:data});
 });
 await page.goto(`${origin}/dashboard/`,{waitUntil:"networkidle"});const card=page.locator(".node-card").first();
 await expect(card).toContainText("周期流量（估算）");await expect(card.locator(".node-network-row").nth(1)).toContainText("↑ —");await card.click();await expect(page.locator("#detail-facts")).toContainText("统计暂不可用");
});
