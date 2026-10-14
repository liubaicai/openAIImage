import { defaultOptions, type Task, type Settings } from "../shared/types";
export const demoSettings: Settings = {
  providers: [
    {
      id: "demo-openai",
      name: "OpenAI",
      type: "openai",
      baseUrl: "https://api.openai.com/v1",
      hasKey: true,
      models: [
        { id: "gpt-image-1", name: "GPT Image", kind: "image", canEdit: true },
        { id: "text-demo", name: "文本模型示例", kind: "text", canEdit: false },
      ],
    },
    {
      id: "demo-router",
      name: "OpenRouter",
      type: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      hasKey: true,
      models: [
        {
          id: "image-demo",
          name: "第二个图像模型",
          kind: "image",
          canEdit: true,
        },
      ],
    },
  ],
  textModel: null,
};
const samples = [
  [
    "静物练习 · 光与陶",
    "一只手工陶瓷花瓶，温暖的自然光从左侧照入，米白色背景，细腻的磨砂质感，极简静物摄影。",
    "photo-1578500494198-246f612d3b3d",
  ],
  [
    "山间，片刻安静",
    "远处的山脉与宁静的湖泊，清晨柔和的薄雾，自然光，电影感构图，低饱和绿色调。",
    "photo-1470770841072-f978cf4d019e",
  ],
  [
    "日常的另一种视角",
    "极简建筑的几何结构，阳光与阴影的切面，温暖的米色混凝土，建筑摄影。",
    "photo-1487958449943-2429e8be8625",
  ],
  [
    "绿意生长",
    "室内的绿色植物，阳光透过叶片，干净温暖的生活方式摄影，自然材质与柔和阴影。",
    "photo-1416879595882-3373a0480b5b",
  ],
  [
    "海岸线的午后",
    "俯瞰平静的海岸线，蓝绿色海水与白色浪花，细腻的沙滩纹理，清爽的夏日氛围。",
    "photo-1473116763249-2faaef81ccda",
  ],
  [
    "关于居住的想象",
    "安静的北欧风格客厅，木质家具、米色织物、柔和的午后阳光，室内建筑摄影。",
    "photo-1600210492486-724fe5c67fb0",
  ],
];
export const demoTasks: Task[] = samples.map(([title, prompt, image], i) => ({
  id: "demo-" + i,
  title,
  prompt,
  options: defaultOptions,
  favorite: i === 1,
  createdAt: new Date(Date.now() - i * 3600000).toISOString(),
  results: [
    {
      id: "result-" + i,
      providerId: "demo-openai",
      providerName: "OpenAI",
      modelId: "gpt-image-1",
      modelName: "GPT Image",
      canEdit: true,
      status: "completed",
      createdAt: new Date().toISOString(),
      elapsed: 24500,
      images: [
        `https://images.unsplash.com/${image}?auto=format&fit=crop&w=1000&q=85`,
      ],
    },
    ...(i === 0
      ? [
          {
            id: "result-second",
            providerId: "demo-router",
            providerName: "OpenRouter",
            modelId: "image-demo",
            modelName: "第二个图像模型",
            canEdit: true,
            status: "completed" as const,
            createdAt: new Date().toISOString(),
            elapsed: 32000,
            images: [
              "https://images.unsplash.com/photo-1490312278390-ab64016e0aa9?auto=format&fit=crop&w=1000&q=85",
            ],
          },
        ]
      : []),
  ],
}));
