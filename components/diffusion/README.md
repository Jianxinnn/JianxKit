# diffusion

AF3 / EDM 风格坐标扩散的标准部件：噪声日程、训练噪声采样、EDM 预条件和损失权重、随机旋转平移增强、Euler 采样器（AF3 Algorithm 18）。网络结构由使用方提供，这里只管扩散本身。

复刻自 [Protenix](https://github.com/bytedance/Protenix)（Apache-2.0）的 `protenix/model/generator.py`、`utils.py`，以及 `modules/diffusion.py`、`loss.py` 里的预条件和损失权重公式。许可证见 [python/LICENSE](python/LICENSE)（随 wheel 一起分发），每个源文件保留原版权声明并写明了改动。

依赖 torch 和 scipy，安装时会一起装上。

## 用法

```python
import torch
from mykit.diffusion import (InferenceNoiseScheduler, TrainingNoiseSampler, edm_loss_weight,
                             edm_preconditioning, sample_diffusion, sample_diffusion_training)

# 网络约定：denoise_net(x_noisy=[..., N_sample, N_atom, 3], t_hat_noise_level=[..., N_sample], **条件) -> x_denoised
class Denoiser(torch.nn.Module):
    def forward(self, x_noisy, t_hat_noise_level, features):
        c_in, c_skip, c_out = (c[..., None, None] for c in edm_preconditioning(t_hat_noise_level))
        return c_skip * x_noisy + c_out * self.f(c_in * x_noisy, t_hat_noise_level, features)

# 训练一步
x_gt, x_denoised, sigma = sample_diffusion_training(TrainingNoiseSampler(), net, coords, mask, N_sample=4, features=f)
loss = (edm_loss_weight(sigma) * ((x_denoised - x_gt) ** 2).mean(dim=(-1, -2))).mean()

# 采样
schedule = InferenceNoiseScheduler()(N_step=200)
x = sample_diffusion(net, schedule, batch_shape=(), N_atom=n_atom, N_sample=5, features=f)
```

- 采样时设备和 dtype 跟随 `noise_schedule`；传给 `sample_diffusion` 的其余关键字参数原样交给网络。
- 默认参数是 AF3 / Protenix 的：`sigma_data=16`（EDM 原文是 1）、`gamma0=0.8`、`noise_scale_lambda=1.003`、`step_scale_eta=1.5`。
- `augment=False` 关掉每步的随机旋转平移（AF3 默认开）。

## 和原代码的差异

- 采样器不再接收 AF3 的 trunk 特征（`s_inputs`、`s_trunk`、`z_trunk`、`pair_z`、`p_lm`、`c_l`、`input_feature_dict`），改为通用的 `**net_kwargs`；原子数和 batch 形状显式传入。
- 去掉 training-free guidance（TFG）和构造函数里的调试 print；`TrainingNoiseSampler` 可传 `generator`。
- 新增 `augment` 开关；预条件和损失权重从 Protenix 的模块里抽成两个函数。
- 训练函数的 `label_dict` 改为 `coordinate`、`coordinate_mask` 两个参数，mask 可省略。
- 修正带 mask 的居中：原代码在有 batch 维时形状对不上（`[B, 3]` 除以 `[B]`），只能处理不带 batch 的输入。
