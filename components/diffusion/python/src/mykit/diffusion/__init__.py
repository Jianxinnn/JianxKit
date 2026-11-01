"""AF3 / EDM 风格坐标扩散的标准部件（来自 Protenix，Apache-2.0）：噪声日程、训练噪声采样、
EDM 预条件和损失权重、随机旋转平移增强、Euler 采样器。网络结构由使用方提供。

    from mykit.diffusion import InferenceNoiseScheduler, sample_diffusion
    x = sample_diffusion(net, InferenceNoiseScheduler()(N_step=200), batch_shape=(), N_atom=n, N_sample=5)
"""

from .augment import centre_random_augmentation, expand_at_dim, rot_vec_mul, uniform_random_rotation
from .edm import InferenceNoiseScheduler, TrainingNoiseSampler, edm_loss_weight, edm_preconditioning
from .sampler import DenoiseNet, sample_diffusion, sample_diffusion_training

__all__ = [
    "DenoiseNet", "InferenceNoiseScheduler", "TrainingNoiseSampler", "centre_random_augmentation", "edm_loss_weight",
    "edm_preconditioning", "expand_at_dim", "rot_vec_mul", "sample_diffusion", "sample_diffusion_training",
    "uniform_random_rotation",
]
