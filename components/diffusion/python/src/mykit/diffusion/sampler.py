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
# Modified for MyKit (2026-11-01): taken from protenix/model/generator.py (sample_diffusion,
# sample_diffusion_training). The AF3 trunk embeddings (s_inputs, s_trunk, z_trunk, pair_z, p_lm, c_l,
# input_feature_dict) and other network options became a generic **net_kwargs passed through to
# denoise_net; the shape is given explicitly; training-free guidance (TFG) was removed; `augment` was added.

from typing import Any, Callable, Optional

import torch

from .augment import centre_random_augmentation
from .edm import TrainingNoiseSampler

# denoise_net(x_noisy=[..., N_sample, N_atom, 3], t_hat_noise_level=[..., N_sample], **net_kwargs) -> x_denoised
DenoiseNet = Callable[..., torch.Tensor]


def sample_diffusion(
    denoise_net: DenoiseNet,
    noise_schedule: torch.Tensor,
    batch_shape: tuple[int, ...],
    N_atom: int,
    N_sample: int = 1,
    gamma0: float = 0.8,
    gamma_min: float = 1.0,
    noise_scale_lambda: float = 1.003,
    step_scale_eta: float = 1.5,
    diffusion_chunk_size: Optional[int] = None,
    augment: bool = True,
    **net_kwargs: Any,
) -> torch.Tensor:
    """Implements Algorithm 18 in AF3.
    It performances denoising steps from time 0 to time T.
    The time steps (=noise levels) are given by noise_schedule.

    Args:
        denoise_net (Callable): the network that performs the denoising step.
        noise_schedule (torch.Tensor): noise-level schedule (which is also the time steps) since sigma=t.
            [N_iterations]; its device and dtype are used for the samples.
        batch_shape (tuple[int, ...]): leading batch dims, () for none.
        N_atom (int): number of atoms (points) per sample.
        N_sample (int): number of generated samples
        gamma0 (float): params in Alg.18.
        gamma_min (float): params in Alg.18.
        noise_scale_lambda (float): params in Alg.18.
        step_scale_eta (float): params in Alg.18.
        diffusion_chunk_size (Optional[int]): Chunk size for diffusion operation. Defaults to None.
        augment (bool): random rotation + translation before every step (Alg.19), as in AF3. Defaults to True.
        **net_kwargs: conditioning passed through to denoise_net unchanged.

    Returns:
        torch.Tensor: the denoised coordinates of x in inference stage
            [..., N_sample, N_atom, 3]
    """
    device = noise_schedule.device
    dtype = noise_schedule.dtype

    def _chunk_sample_diffusion(chunk_n_sample):
        # init noise
        # [..., N_sample, N_atom, 3]
        x_l = noise_schedule[0] * torch.randn(
            size=(*batch_shape, chunk_n_sample, N_atom, 3), device=device, dtype=dtype
        )  # NOTE: set seed in distributed training

        for c_tau_last, c_tau in zip(noise_schedule[:-1], noise_schedule[1:]):
            # [..., N_sample, N_atom, 3]
            if augment:
                x_l = (
                    centre_random_augmentation(x_input_coords=x_l, N_sample=1)
                    .squeeze(dim=-3)
                    .to(dtype)
                )

            # Denoise with a predictor-corrector sampler
            # 1. Add noise to move x_{c_tau_last} to x_{t_hat}
            gamma = float(gamma0) if c_tau > gamma_min else 0
            t_hat = c_tau_last * (gamma + 1)

            delta_noise_level = torch.sqrt(t_hat**2 - c_tau_last**2)
            x_noisy = x_l + noise_scale_lambda * delta_noise_level * torch.randn(
                size=x_l.shape, device=device, dtype=dtype
            )

            # 2. Denoise from x_{t_hat} to x_{c_tau}
            # Euler step only
            t_hat = (
                t_hat.reshape((1,) * (len(batch_shape) + 1))
                .expand(*batch_shape, chunk_n_sample)
                .to(dtype)
            )

            x_denoised = denoise_net(x_noisy=x_noisy, t_hat_noise_level=t_hat, **net_kwargs)

            delta = (x_noisy - x_denoised) / t_hat[
                ..., None, None
            ]  # Line 9 of AF3 uses 'x_l_hat' instead, which we believe  is a typo.
            dt = c_tau - t_hat
            x_l = x_noisy + step_scale_eta * dt[..., None, None] * delta

        return x_l

    if diffusion_chunk_size is None:
        return _chunk_sample_diffusion(N_sample)
    x_l = []
    no_chunks = N_sample // diffusion_chunk_size + (N_sample % diffusion_chunk_size != 0)
    for i in range(no_chunks):
        chunk_n_sample = (
            diffusion_chunk_size
            if i < no_chunks - 1
            else N_sample - i * diffusion_chunk_size
        )
        x_l.append(_chunk_sample_diffusion(chunk_n_sample))
    return torch.cat(x_l, -3)  # [..., N_sample, N_atom, 3]


def sample_diffusion_training(
    noise_sampler: TrainingNoiseSampler,
    denoise_net: DenoiseNet,
    coordinate: torch.Tensor,
    coordinate_mask: Optional[torch.Tensor] = None,
    N_sample: int = 1,
    diffusion_chunk_size: Optional[int] = None,
    **net_kwargs: Any,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """Implements diffusion training as described in AF3 Appendix at page 23.

    Args:
        noise_sampler (TrainingNoiseSampler): sampler for training noise-level.
        denoise_net (Callable): the network that performs the denoising step.
        coordinate (torch.Tensor): the ground-truth coordinates
            [..., N_atom, 3]
        coordinate_mask (Optional[torch.Tensor]): whether true coordinates exist.
            [..., N_atom]
        N_sample (int): number of training samples
        diffusion_chunk_size (Optional[int]): Chunk size for diffusion operation. Defaults to None.
        **net_kwargs: conditioning passed through to denoise_net unchanged.

    Returns:
        tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
            x_gt_augment: the augmented ground-truth coordinates [..., N_sample, N_atom, 3]
            x_denoised: the denoised coordinates [..., N_sample, N_atom, 3]
            sigma: the sampled noise-level [..., N_sample]
    """
    batch_size_shape = coordinate.shape[:-2]
    device = coordinate.device
    dtype = coordinate.dtype
    # Create N_sample versions of the input structure by randomly rotating and translating
    x_gt_augment = centre_random_augmentation(
        x_input_coords=coordinate,
        N_sample=N_sample,
        mask=coordinate_mask,
    ).to(
        dtype
    )  # [..., N_sample, N_atom, 3]

    # Add independent noise to each structure
    # sigma: independent noise-level [..., N_sample]
    sigma = noise_sampler(size=(*batch_size_shape, N_sample), device=device).to(dtype)
    # noise: [..., N_sample, N_atom, 3]
    noise = torch.randn_like(x_gt_augment, dtype=dtype) * sigma[..., None, None]

    # Get denoising outputs [..., N_sample, N_atom, 3]
    if diffusion_chunk_size is None:
        x_denoised = denoise_net(x_noisy=x_gt_augment + noise, t_hat_noise_level=sigma, **net_kwargs)
    else:
        x_denoised = []
        no_chunks = N_sample // diffusion_chunk_size + (N_sample % diffusion_chunk_size != 0)
        for i in range(no_chunks):
            x_noisy_i = (x_gt_augment + noise)[
                ..., i * diffusion_chunk_size : (i + 1) * diffusion_chunk_size, :, :
            ]
            t_hat_noise_level_i = sigma[
                ..., i * diffusion_chunk_size : (i + 1) * diffusion_chunk_size
            ]
            x_denoised.append(denoise_net(x_noisy=x_noisy_i, t_hat_noise_level=t_hat_noise_level_i, **net_kwargs))
        x_denoised = torch.cat(x_denoised, dim=-3)

    return x_gt_augment, x_denoised, sigma
