# Copyright 2024 ByteDance and/or its affiliates.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# Modified for MyKit (2026-11-01): taken from protenix/model/generator.py (noise sampler / scheduler),
# protenix/model/modules/diffusion.py (preconditioning) and protenix/model/loss.py (loss weight);
# removed debug prints, added `generator`, and turned inline formulas into functions.

import torch


class TrainingNoiseSampler:
    """
    Sample the noise-level of training samples: sigma = sigma_data * exp(p_mean + p_std * N(0, 1)).

    Args:
        p_mean (float, optional): gaussian mean. Defaults to -1.2.
        p_std (float, optional): gaussian std. Defaults to 1.5.
        sigma_data (float, optional): scale. Defaults to 16.0, but this is 1.0 in EDM.
    """

    def __init__(
        self,
        p_mean: float = -1.2,
        p_std: float = 1.5,
        sigma_data: float = 16.0,  # NOTE: in EDM, this is 1.0
    ) -> None:
        self.sigma_data = sigma_data
        self.p_mean = p_mean
        self.p_std = p_std

    def __call__(
        self,
        size: torch.Size | tuple[int, ...],
        device: torch.device | str = "cpu",
        generator: torch.Generator | None = None,
    ) -> torch.Tensor:
        """Returns sampled noise-levels of shape `size`."""
        rnd_normal = torch.randn(size=size, device=device, generator=generator)
        noise_level = (rnd_normal * self.p_std + self.p_mean).exp() * self.sigma_data
        return noise_level


class InferenceNoiseScheduler:
    """
    Scheduler for noise-level (time steps), the Karras / EDM schedule scaled by sigma_data.

    Args:
        s_max (float, optional): maximal noise level. Defaults to 160.0.
        s_min (float, optional): minimal noise level. Defaults to 4e-4.
        rho (float, optional): the exponent numerical part. Defaults to 7.
        sigma_data (float, optional): scale. Defaults to 16.0, but this is 1.0 in EDM.
    """

    def __init__(
        self,
        s_max: float = 160.0,
        s_min: float = 4e-4,
        rho: float = 7,
        sigma_data: float = 16.0,  # NOTE: in EDM, this is 1.0
    ) -> None:
        self.sigma_data = sigma_data
        self.s_max = s_max
        self.s_min = s_min
        self.rho = rho

    def __call__(
        self,
        N_step: int = 200,
        device: torch.device | str = "cpu",
        dtype: torch.dtype = torch.float32,
    ) -> torch.Tensor:
        """Schedule the noise-level (time steps). No sampling is performed.

        Returns:
            torch.Tensor: noise-level (time_steps), decreasing, last entry 0
                [N_step+1]
        """
        step_size = 1 / N_step
        step_indices = torch.arange(N_step + 1, device=device, dtype=dtype)
        t_step_list = (
            self.sigma_data
            * (
                self.s_max ** (1 / self.rho)
                + step_indices
                * step_size
                * (self.s_min ** (1 / self.rho) - self.s_max ** (1 / self.rho))
            )
            ** self.rho
        )
        # replace the last time step by 0
        t_step_list[..., -1] = 0  # t_N = 0

        return t_step_list


def edm_preconditioning(sigma: torch.Tensor, sigma_data: float = 16.0) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """EDM coefficients, as used by Protenix's DiffusionModule:

        r_noisy    = c_in * x_noisy,                c_in   = 1 / sqrt(sigma_data^2 + sigma^2)
        x_denoised = c_skip * x_noisy + c_out * F,  c_skip = 1 / (1 + (sigma / sigma_data)^2)
                                                    c_out  = sigma / sqrt(1 + (sigma / sigma_data)^2)

    Returns (c_in, c_skip, c_out), each shaped like sigma; add [..., None, None] to broadcast over [N_atom, 3].
    The network's noise embedding in Protenix is c_noise = log(sigma / sigma_data) / 4.
    """
    s_ratio = sigma / sigma_data
    c_in = 1 / torch.sqrt(sigma_data**2 + sigma**2)
    c_skip = 1 / (1 + s_ratio**2)
    c_out = sigma / torch.sqrt(1 + s_ratio**2)
    return c_in, c_skip, c_out


def edm_loss_weight(sigma: torch.Tensor, sigma_data: float = 16.0) -> torch.Tensor:
    """Per-sample weight of the denoising loss: (sigma^2 + sigma_data^2) / (sigma_data * sigma)^2."""
    return (sigma**2 + sigma_data**2) / (sigma_data * sigma) ** 2
