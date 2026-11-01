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
# Modified for MyKit (2026-11-01): taken from protenix/model/utils.py (centre_random_augmentation,
# uniform_random_rotation, rot_vec_mul, expand_at_dim). The masked centre now divides by
# mask.sum(dim=-1, keepdim=True), so masks also work with batch dimensions.

from typing import Optional

import torch
from scipy.spatial.transform import Rotation


def centre_random_augmentation(
    x_input_coords: torch.Tensor,
    N_sample: int = 1,
    s_trans: float = 1.0,
    centre_only: bool = False,
    mask: Optional[torch.Tensor] = None,
    eps: float = 1e-12,
) -> torch.Tensor:
    """Implements Algorithm 19 in AF3

    Args:
        x_input_coords (torch.Tensor): input coords
            [..., N_atom, 3]
        N_sample (int, optional): the total number of augmentation. Defaults to 1.
        s_trans (float, optional): scale factor of trans. Defaults to 1.0.
        centre_only (bool, optional): if set true, will only perform centering without applying random translation and rotation.
        mask (torch.Tensor, optional): masking for the coords
            [..., N_atom]
        eps (float, optional): small number used for masked mean
    Returns:
        torch.Tensor:  the Augmentation version of input coords
            [..., N_sample, N_atom, 3]
    """

    N_atom = x_input_coords.size(-2)
    device = x_input_coords.device

    # Move to origin [..., N_atom, 3]
    if mask is None:
        x_input_coords = x_input_coords - torch.mean(
            input=x_input_coords, dim=-2, keepdim=True
        )
    else:
        center = (x_input_coords * mask.unsqueeze(dim=-1)).sum(dim=-2) / (
            mask.sum(dim=-1, keepdim=True) + eps
        )
        x_input_coords = x_input_coords - center.unsqueeze(dim=-2)

    # Expand to [..., N_sample, N_atom, 3]
    x_input_coords = expand_at_dim(x_input_coords, dim=-3, n=N_sample)

    if centre_only:
        return x_input_coords

    # N_augment = batch_size * N_sample
    N_augment = torch.numel(x_input_coords[..., 0, 0])

    # Generate N_augment (rot, trans) pairs
    batch_size_shape = x_input_coords.shape[:-3]
    rot_matrix_random = (
        uniform_random_rotation(N_sample=N_augment)
        .to(device)
        .reshape(*batch_size_shape, N_sample, 3, 3)
    ).detach()  # [..., N_sample, 3, 3]
    trans_random = s_trans * torch.randn(
        size=(*batch_size_shape, N_sample, 3), device=device
    )  # [..., N_sample, 3]
    x_augment_coords = (
        rot_vec_mul(
            r=expand_at_dim(rot_matrix_random, dim=-3, n=N_atom), t=x_input_coords
        )
        + trans_random[..., None, :]
    )  # [..., N_sample, N_atom, 3]

    if mask is not None:
        x_augment_coords = x_augment_coords * mask[..., None, :, None]
    return x_augment_coords


# Comment: Rotation.random is not supported by torch.compile()
def uniform_random_rotation(N_sample: int = 1) -> torch.Tensor:
    """Generate random rotation matrices with scipy.spatial.transform.Rotation

    Args:
        N_sample (int, optional): the total number of augmentation. Defaults to 1.

    Returns:
        torch.Tensor: N_sample rot matrics
            [N_sample, 3, 3]
    """
    rotation = Rotation.random(num=N_sample)
    rot_matrix = torch.from_numpy(rotation.as_matrix()).float()  # [N_sample, 3, 3]
    return rot_matrix


# this is from openfold.utils.rigid_utils import rot_vec_mul
# precision is added
def rot_vec_mul(r: torch.Tensor, t: torch.Tensor) -> torch.Tensor:
    """Apply rot matrix to vector
    Applies a rotation to a vector. Written out by hand to avoid transfer
    to avoid AMP downcasting.

    Args:
        r (torch.Tensor): the rotation matrices
            [..., 3, 3]
        t (torch.Tensor): the coordinate tensors
            [..., 3]

    Returns:
        torch.Tensor: the rotated coordinates
    """
    if t.dtype != torch.float32:
        t = t.to(dtype=torch.float32)
    if r.dtype != torch.float32:
        r = r.to(dtype=torch.float32)

    x, y, z = torch.unbind(input=t, dim=-1)
    return torch.stack(
        tensors=[
            r[..., 0, 0] * x + r[..., 0, 1] * y + r[..., 0, 2] * z,
            r[..., 1, 0] * x + r[..., 1, 1] * y + r[..., 1, 2] * z,
            r[..., 2, 0] * x + r[..., 2, 1] * y + r[..., 2, 2] * z,
        ],
        dim=-1,
    )


def expand_at_dim(x: torch.Tensor, dim: int, n: int) -> torch.Tensor:
    """expand a tensor at specific dim by n times

    Args:
        x (torch.Tensor): input
        dim (int): dimension to expand
        n (int): expand size

    Returns:
        torch.Tensor: expanded tensor of shape [..., n, ...]
    """
    x = x.unsqueeze(dim=dim)
    if dim < 0:
        dim = x.dim() + dim
    before_shape = x.shape[:dim]
    after_shape = x.shape[dim + 1 :]
    return x.expand(*before_shape, n, *after_shape)
