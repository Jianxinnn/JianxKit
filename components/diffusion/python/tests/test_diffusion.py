import pytest
import torch

from mykit.diffusion import (
    InferenceNoiseScheduler,
    TrainingNoiseSampler,
    centre_random_augmentation,
    edm_loss_weight,
    edm_preconditioning,
    sample_diffusion,
    sample_diffusion_training,
    uniform_random_rotation,
)


@pytest.fixture(autouse=True)
def seed():
    torch.manual_seed(0)


def test_inference_schedule_is_decreasing_and_ends_at_zero():
    schedule = InferenceNoiseScheduler()(N_step=10)
    assert schedule.shape == (11,)
    assert schedule[0].item() == pytest.approx(16.0 * 160.0)
    assert schedule[-1].item() == 0
    assert torch.all(schedule[1:] < schedule[:-1])


def test_training_noise_is_positive_with_requested_shape():
    sigma = TrainingNoiseSampler()(size=(4, 8))
    assert sigma.shape == (4, 8) and torch.all(sigma > 0)


def test_random_rotations_are_proper():
    r = uniform_random_rotation(N_sample=5)
    assert torch.allclose(r @ r.transpose(-1, -2), torch.eye(3).expand(5, 3, 3), atol=1e-5)
    assert torch.allclose(torch.linalg.det(r), torch.ones(5), atol=1e-5)


def test_augmentation_is_rigid_and_centring_works():
    x = torch.randn(7, 3) * 5 + 10
    augmented = centre_random_augmentation(x, N_sample=3)
    assert augmented.shape == (3, 7, 3)
    assert torch.allclose(torch.cdist(augmented, augmented), torch.cdist(x, x).expand(3, 7, 7), atol=1e-4)
    centred = centre_random_augmentation(x, N_sample=2, centre_only=True)
    assert torch.allclose(centred.mean(dim=-2), torch.zeros(2, 3), atol=1e-5)


def test_masked_centring_with_batch_dims():
    x = torch.randn(2, 5, 3) + 10
    mask = torch.tensor([[1, 1, 1, 0, 0], [1, 1, 1, 1, 1]], dtype=torch.float32)
    centred = centre_random_augmentation(x, N_sample=1, centre_only=True, mask=mask)[:, 0]
    masked_mean = (centred * mask[..., None]).sum(dim=-2) / mask.sum(dim=-1, keepdim=True)
    assert torch.allclose(masked_mean, torch.zeros(2, 3), atol=1e-5)


@pytest.mark.parametrize("augment", [False, True])
def test_sampler_with_oracle_denoiser_returns_target(augment):
    # 网络总是给出 target 时，eta=1 的最后一步（c_tau=0）正好落到 target
    target = torch.randn(6, 3)
    oracle = lambda x_noisy, t_hat_noise_level: target.expand_as(x_noisy)
    schedule = InferenceNoiseScheduler()(N_step=8)
    x = sample_diffusion(oracle, schedule, batch_shape=(), N_atom=6, N_sample=2, step_scale_eta=1.0, augment=augment)
    assert x.shape == (2, 6, 3)
    assert torch.allclose(x, target.expand(2, 6, 3), atol=1e-3)


def test_sampler_chunking_and_net_kwargs():
    seen = []

    def net(x_noisy, t_hat_noise_level, condition):
        seen.append((x_noisy.shape, t_hat_noise_level.shape, condition))
        return torch.zeros_like(x_noisy)

    x = sample_diffusion(net, InferenceNoiseScheduler()(N_step=3), batch_shape=(2,), N_atom=4, N_sample=3, diffusion_chunk_size=2, condition="c")
    assert x.shape == (2, 3, 4, 3)
    assert seen[0] == (torch.Size([2, 2, 4, 3]), torch.Size([2, 2]), "c")
    assert seen[-1][0] == torch.Size([2, 1, 4, 3])


@pytest.mark.parametrize("chunk", [None, 3])
def test_training_step_shapes_and_mask(chunk):
    coordinate = torch.randn(2, 5, 3)
    mask = torch.tensor([[1, 1, 1, 0, 0], [1, 1, 1, 1, 1]], dtype=torch.float32)
    identity = lambda x_noisy, t_hat_noise_level: x_noisy
    x_gt, x_denoised, sigma = sample_diffusion_training(
        TrainingNoiseSampler(), identity, coordinate, mask, N_sample=4, diffusion_chunk_size=chunk
    )
    assert x_gt.shape == x_denoised.shape == (2, 4, 5, 3)
    assert sigma.shape == (2, 4) and torch.all(sigma > 0)
    assert torch.all(x_gt[0, :, 3:] == 0)


def test_edm_coefficients():
    sigma = torch.tensor([1e-4, 16.0, 1e4])
    c_in, c_skip, c_out = edm_preconditioning(sigma, sigma_data=16.0)
    assert c_skip[0].item() == pytest.approx(1.0) and c_skip[2].item() < 1e-5
    assert c_skip[1].item() == pytest.approx(0.5)
    assert torch.allclose(c_in, 1 / torch.sqrt(16.0**2 + sigma**2))
    assert c_out[1].item() == pytest.approx(16.0 / 2**0.5)
    assert edm_loss_weight(torch.tensor(16.0), sigma_data=16.0).item() == pytest.approx(2 / 16.0**2)
